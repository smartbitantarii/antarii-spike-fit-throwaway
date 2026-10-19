// Step 1a's three stubs, in one process — M1's shape: "the three stubs being
// one process".
//
// Go because ADR-001 (c) makes Go the backend default; this follows that
// decision rather than making one.
//
// What each stub is for, and the requirement behind it:
//
//	/session  — a token carrying PRICE VISIBILITY. SwR-012 and SwR-172 keep
//	            cost price, margin and internal notes away from the customer,
//	            so visibility is a property of the session, not of the record.
//
//	/grant    — a single-use, short-lived grant for one media part hand-off.
//	            ADR-003 §5.3.3: "nothing is handed to the platform carrying a
//	            credential that outlives the moment it was created." Single-use
//	            is enforced here, not just time-bounded, because a grant that
//	            can be replayed outlives its moment whatever its TTL says.
//
//	/batch    — receives a per-record batch and answers TWO acknowledgements,
//	            separately. SwR-109 is explicit that durable storage is "not
//	            merely received (a distinct acknowledgement)", and the queue's
//	            own tests model them as two states. A stub that conflated them
//	            would make the device's queue untestable in the one way that
//	            matters.
package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

type grant struct {
	Token     string    `json:"token"`
	MediaID   string    `json:"mediaId"`
	Part      int       `json:"part"`
	ExpiresAt time.Time `json:"expiresAt"`
	used      bool
}

type server struct {
	mu     sync.Mutex
	grants map[string]*grant
	// batches that have been durably confirmed, so a resend is idempotent —
	// ADR-004 §6.4 exists because this queue's own state makes resends
	// inevitable.
	confirmed map[string]bool
	ttl       time.Duration
	seq       int
}

func main() {
	ttl := 60
	if v := os.Getenv("GRANT_TTL_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			ttl = n
		}
	}
	s := &server{
		grants:    map[string]*grant{},
		confirmed: map[string]bool{},
		ttl:       time.Duration(ttl) * time.Second,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/session", s.session)
	mux.HandleFunc("/grant", s.grant)
	mux.HandleFunc("/grant/redeem", s.redeem)
	mux.HandleFunc("/batch", s.batch)
	mux.HandleFunc("/batch/confirm", s.confirm)
	mux.HandleFunc("/figures", s.figures)

	log.Printf("1a stubs listening on :8080; figures -> %s", figuresDir())
	srv := &http.Server{
		Addr:              ":8080",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}

// ---------------------------------------------------------------- the session

// A worker's session carries price visibility; a customer-facing one does not.
// SwR-012 and SwR-172 make that a property of who is asking, so the stub takes
// a role and answers accordingly rather than letting the caller assert it.
func (s *server) session(w http.ResponseWriter, r *http.Request) {
	role := r.URL.Query().Get("role")
	if role == "" {
		role = "worker"
	}
	prices := role == "worker" || role == "office"
	writeJSON(w, http.StatusOK, map[string]any{
		"token":          "session-" + role,
		"role":           role,
		"priceVisible":   prices,
		"costPriceVisible": role == "office", // never the worker, never the customer
	})
}

// ------------------------------------------------------------------ the grant

func (s *server) grant(w http.ResponseWriter, r *http.Request) {
	mediaID := r.URL.Query().Get("mediaId")
	part, _ := strconv.Atoi(r.URL.Query().Get("part"))
	if mediaID == "" {
		http.Error(w, "mediaId required", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	s.seq++
	g := &grant{
		Token:     "grant-" + strconv.Itoa(s.seq),
		MediaID:   mediaID,
		Part:      part,
		ExpiresAt: time.Now().Add(s.ttl),
	}
	s.grants[g.Token] = g
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, g)
}

// Redeeming proves the grant did not outlive its moment: single-use AND
// time-bounded. Replay is refused even inside the TTL.
func (s *server) redeem(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	s.mu.Lock()
	defer s.mu.Unlock()
	g, ok := s.grants[token]
	switch {
	case !ok:
		http.Error(w, "unknown grant", http.StatusForbidden)
	case g.used:
		// the case a TTL alone would miss
		http.Error(w, "grant already used", http.StatusForbidden)
	case time.Now().After(g.ExpiresAt):
		http.Error(w, "grant expired", http.StatusForbidden)
	default:
		g.used = true
		writeJSON(w, http.StatusOK, map[string]any{"redeemed": true, "part": g.Part})
	}
}

// ------------------------------------------------------------------ the batch

// The transport acknowledgement. Deliberately NOT delivery.
func (s *server) batch(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("batch")
	if id == "" {
		http.Error(w, "batch required", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"batch":    id,
		"received": true,
		// stated in the response so a reader of the wire cannot mistake one
		// acknowledgement for the other
		"durablyStored": false,
		"note":          "received only; durable storage is a distinct acknowledgement (SwR-109)",
	})
}

// The distinct acknowledgement SwR-109 requires, and idempotent because a
// "sent, awaiting confirmation" batch will be resent (ADR-004 §6.4).
func (s *server) confirm(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("batch")
	if id == "" {
		http.Error(w, "batch required", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	first := !s.confirmed[id]
	s.confirmed[id] = true
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"batch":         id,
		"durablyStored": true,
		// the device must treat a repeat as the same confirmation, not a new
		// one: a second confirmation must not restart SyR-153's window
		"firstConfirmation": first,
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// --------------------------------------------------------------- the figures

// Where §8's records land. A run on a phone produces figures that exist only
// in that phone's memory; without somewhere to send them the whole campaign
// is unrecoverable the moment the app is closed.
//
// ⚠ The directory is bind-mounted from the host, so the records survive the
// container. A file written only inside it would be lost on the next
// `docker compose down`, which is exactly the failure this endpoint exists to
// prevent — and it would be lost silently, after the run.
func figuresDir() string {
	if v := os.Getenv("FIGURES_DIR"); v != "" {
		return v
	}
	return "/figures"
}

// 🔴 A phone must not be able to choose a path on the host. Everything outside
// a conservative allowlist becomes '-', so a payload claiming a device of
// "../../etc/passwd" yields a harmless name rather than a traversal.
func safeName(s string, max int) string {
	out := make([]rune, 0, max)
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '.':
			out = append(out, r)
		default:
			out = append(out, '-')
		}
		if len(out) >= max {
			break
		}
	}
	if len(out) == 0 {
		return "unknown"
	}
	return string(out)
}

// POST a run record. The body is stored verbatim — the device's bytes are the
// evidence, and re-serialising them here would mean §8 holds this stub's idea
// of the record rather than the one the run produced.
func (s *server) figures(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST a run record", http.StatusMethodNotAllowed)
		return
	}

	// A device should not be able to fill the host's disk. 32 MB is far above
	// any plausible record — 100 samples per figure is kilobytes — and far
	// below anything that matters.
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "could not read the body: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Validated as JSON but NOT re-encoded, for the reason above.
	var probe map[string]any
	if err := json.Unmarshal(body, &probe); err != nil {
		http.Error(w, "the body is not a JSON object: "+err.Error(), http.StatusBadRequest)
		return
	}

	device, _ := probe["device"].(map[string]any)
	model := "unknown"
	if device != nil {
		if m, ok := device["model"].(string); ok && m != "" {
			model = m
		}
	}
	build := "unknown"
	if b, ok := probe["buildId"].(string); ok && b != "" {
		build = b
	}

	dir := figuresDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		http.Error(w, "cannot create "+dir+": "+err.Error(), http.StatusInternalServerError)
		return
	}

	// ⚠ The timestamp leads the name so records sort chronologically, and it
	// carries nanoseconds so two runs in the same second cannot collide. A
	// clobbered record would be indistinguishable from one never sent.
	name := time.Now().UTC().Format("20060102-150405.000000000") +
		"_" + safeName(model, 40) + "_" + safeName(build, 16) + ".json"
	path := dir + "/" + name

	// Written to a temporary name and renamed, so a reader never sees a
	// half-written record and a failed write leaves nothing behind.
	tmp := path + ".partial"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		http.Error(w, "cannot write the record: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		http.Error(w, "cannot finalise the record: "+err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("figures: stored %s (%d bytes)", name, len(body))
	writeJSON(w, http.StatusOK, map[string]any{"stored": name, "bytes": len(body)})
}
