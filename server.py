import json
import os
import re
import time
import urllib.request
from datetime import date
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", 3000))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
LEADERBOARD_PATH = os.path.join(BASE_DIR, "data", "leaderboard.json")
MAX_PLAYER_GUESSES = 5
SYSTEM_DICT_PATH = "/usr/share/dict/words"

FALLBACK_WORDS = ["CRANE", "PLANT", "SOLAR", "TRACE", "GLINT", "VIVID", "QUARK", "NOVAE"]


def load_word_list():
    words = set()
    try:
        with open(SYSTEM_DICT_PATH, "r", errors="ignore") as f:
            for line in f:
                w = line.strip()
                if re.fullmatch(r"[a-z]{5}", w):
                    words.add(w.upper())
    except OSError:
        pass
    if not words:
        words.update(FALLBACK_WORDS)
    return sorted(words)


WORD_LIST = load_word_list()
WORD_SET = set(WORD_LIST)


def hash_string(s):
    h = 0
    for ch in s:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h


def date_key():
    return date.today().isoformat()


def pick_deterministic_word(seed, exclude):
    word_list = WORD_LIST if WORD_LIST else FALLBACK_WORDS
    index = hash_string(seed) % len(word_list)
    while word_list[index] == exclude:
        index = (index + 1) % len(word_list)
    return word_list[index]


_nyt_cache = {}


def get_answer_for_date(day):
    if day in _nyt_cache:
        return _nyt_cache[day]

    answer = None
    fallback = False
    try:
        url = f"https://www.nytimes.com/svc/wordle/v2/{day}.json"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        solution = payload.get("solution", "")
        if not re.fullmatch(r"[A-Za-z]{5}", solution):
            raise ValueError("Unexpected NYT payload")
        answer = solution.upper()
    except Exception as err:
        fallback = True
        idx = hash_string(day) % len(FALLBACK_WORDS)
        answer = FALLBACK_WORDS[idx]
        print(f"[wordle] Falling back to local word for {day}: {err}")

    result = {"answer": answer, "fallback": fallback}
    _nyt_cache[day] = result
    return result


def score_guess(guess, answer):
    feedback = ["absent"] * 5
    remaining = {}

    for i in range(5):
        if guess[i] == answer[i]:
            feedback[i] = "correct"
        else:
            remaining[answer[i]] = remaining.get(answer[i], 0) + 1

    for i in range(5):
        if feedback[i] == "correct":
            continue
        letter = guess[i]
        if remaining.get(letter, 0) > 0:
            feedback[i] = "present"
            remaining[letter] -= 1

    return feedback


def compute_score(won, guesses_used):
    if not won:
        return 0
    clamped = min(max(guesses_used, 1), MAX_PLAYER_GUESSES)
    return (MAX_PLAYER_GUESSES + 1 - clamped) * 100 + 100


def read_leaderboard():
    try:
        with open(LEADERBOARD_PATH, "r") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return []


def write_leaderboard(entries):
    with open(LEADERBOARD_PATH, "w") as f:
        json.dump(entries, f, indent=2)


def clean_name(name):
    return (name.strip() if isinstance(name, str) else "")[:20].upper() or "ANONYMOUS"


def find_today_entry(name):
    if not name:
        return None
    day = date_key()
    target = clean_name(name)
    for entry in read_leaderboard():
        if entry.get("date") == day and entry.get("name") == target:
            return entry
    return None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def log_message(self, fmt, *args):
        print("[http]", fmt % args)

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def do_GET(self):
        if self.path.startswith("/api/daily"):
            return self.handle_daily()
        if self.path.startswith("/api/leaderboard"):
            return self.handle_leaderboard()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/guess"):
            return self.handle_guess()
        if self.path.startswith("/api/score"):
            return self.handle_score()
        self.send_json({"error": "Not found"}, 404)

    def handle_daily(self):
        query = parse_qs(urlparse(self.path).query)
        name = query.get("name", [""])[0]

        day = date_key()
        result = get_answer_for_date(day)
        answer = result["answer"]
        starting_word = pick_deterministic_word(f"{day}-start", answer)
        starting_feedback = score_guess(starting_word, answer)
        existing_entry = find_today_entry(name) if name else None

        self.send_json({
            "date": day,
            "startingWord": starting_word,
            "startingFeedback": starting_feedback,
            "maxPlayerGuesses": MAX_PLAYER_GUESSES,
            "usingFallback": result["fallback"],
            "alreadyPlayed": existing_entry is not None,
            "existingEntry": existing_entry,
        })

    def handle_guess(self):
        body = self.read_json_body()
        guess = body.get("guess")
        attempt_number = body.get("attemptNumber")
        name = body.get("name")

        if find_today_entry(name):
            return self.send_json({"error": "You've already played today's transmission."}, 403)

        if not isinstance(guess, str) or not re.fullmatch(r"[A-Za-z]{5}", guess):
            return self.send_json({"error": "Guess must be exactly 5 letters."}, 400)

        upper_guess = guess.upper()
        if upper_guess not in WORD_SET:
            return self.send_json({"error": "Not a recognized word."}, 400)

        day = date_key()
        result = get_answer_for_date(day)
        answer = result["answer"]
        feedback = score_guess(upper_guess, answer)
        correct = upper_guess == answer

        response = {"feedback": feedback, "correct": correct}
        try:
            attempt_number = int(attempt_number)
        except (TypeError, ValueError):
            attempt_number = 0
        if not correct and attempt_number >= MAX_PLAYER_GUESSES:
            response["answer"] = answer

        self.send_json(response)

    def handle_score(self):
        body = self.read_json_body()
        name = body.get("name")
        won = bool(body.get("won"))
        guesses_used = body.get("guessesUsed")

        existing = find_today_entry(name)
        if existing:
            return self.send_json({"entry": existing, "duplicate": True})

        try:
            clean_guesses = int(guesses_used)
        except (TypeError, ValueError):
            clean_guesses = 0
        clean_guesses = min(max(clean_guesses, 0), MAX_PLAYER_GUESSES)

        entry = {
            "name": clean_name(name),
            "date": date_key(),
            "won": won,
            "guessesUsed": clean_guesses,
            "score": compute_score(won, clean_guesses),
            "ts": int(time.time() * 1000),
        }

        entries = read_leaderboard()
        entries.append(entry)
        write_leaderboard(entries)

        self.send_json({"entry": entry})

    def handle_leaderboard(self):
        query = parse_qs(urlparse(self.path).query)
        scope = "today" if query.get("scope", [""])[0] == "today" else "alltime"
        day = date_key()

        entries = read_leaderboard()
        if scope == "today":
            entries = [e for e in entries if e.get("date") == day]

        entries = sorted(
            entries,
            key=lambda e: (-e.get("score", 0), e.get("guessesUsed", 99), e.get("ts", 0)),
        )[:50]

        self.send_json({"scope": scope, "date": day, "entries": entries})


def main():
    os.makedirs(os.path.dirname(LEADERBOARD_PATH), exist_ok=True)
    if not os.path.exists(LEADERBOARD_PATH):
        write_leaderboard([])

    handler = partial(Handler)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), handler)
    print(f"Cryptic running at http://localhost:{PORT}")
    print(f"Loaded {len(WORD_LIST)} valid 5-letter words.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
