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

	log.Println("1a stubs listening on :8080")
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
