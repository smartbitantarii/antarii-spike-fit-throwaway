#!/bin/sh
# Provenance scan — ADR-001 §8.3 rule 7.
#
# Rule 7 requires a commit-time guard on what enters a protected history: a secret
# scan and a provenance scan over "the estate's originating organisation, its
# repository names, module paths and documentation paths". The secret scan is
# server-side (GitHub push protection, enabled at creation). This is the provenance
# half, which no host can do for us because the list cannot be published.
#
# Rule 7: "The provenance list must not live in the repository ... the list stays
# untracked — supplied locally from the owner's own records — and a missing list
# makes the hook fail loudly rather than pass silently."
#
# Usage:  provenance-scan.sh staged
#         provenance-scan.sh range <old-sha> <new-sha>

set -eu

GITDIR=$(git rev-parse --git-dir)
LIST="$GITDIR/provenance-forbidden.txt"

fail() {
    echo "" >&2
    echo "PROVENANCE SCAN FAILED — $1" >&2
    echo "" >&2
    exit 1
}

if [ ! -f "$LIST" ]; then
    fail "no provenance list at $LIST

Rule 7 requires this guard and requires the list to stay OUT of the repository.
Supply it locally, one forbidden string per line, '#' for comments:

    \$EDITOR \"$LIST\"

It must contain the prior-project estate's originating organisation name, its
repository names, module paths and documentation paths. .git/ is never committed,
so the list cannot leak through this history.

A missing list fails loudly rather than passing silently — also rule 7."
fi

# Non-empty, non-comment entries. Numbered, so a match can be reported without
# echoing the forbidden string itself into a terminal, a log or CI output.
ENTRIES=$(grep -v '^[[:space:]]*#' "$LIST" | grep -v '^[[:space:]]*$' || true)
if [ -z "$ENTRIES" ]; then
    fail "the provenance list at $LIST has no entries.
An empty list is treated as a missing one — it must fail loudly, not pass silently."
fi

case "${1:-}" in
    staged)
        SUBJECT=$(git diff --cached --no-color 2>/dev/null || true)
        WHAT="the staged change"
        ;;
    range)
        [ $# -eq 3 ] || fail "usage: provenance-scan.sh range <old-sha> <new-sha>"
        SUBJECT=$(git diff --no-color "$2" "$3" 2>/dev/null || true)
        WHAT="the commits being pushed"
        ;;
    *)
        fail "usage: provenance-scan.sh staged | range <old-sha> <new-sha>"
        ;;
esac

# A unified diff carries added content AND the +++ b/<path> lines, so one pass
# covers content, file names and directory paths together.
[ -n "$SUBJECT" ] || exit 0

n=0
hits=0
printf '%s\n' "$ENTRIES" | while IFS= read -r entry; do
    n=$((n + 1))
    if printf '%s\n' "$SUBJECT" | grep -i -q -F -- "$entry"; then
        echo "  provenance list entry #$n matches $WHAT" >&2
        hits=$((hits + 1))
    fi
    # The subshell cannot export hits, so record a marker file instead.
    [ "$hits" -eq 0 ] || : > "$GITDIR/.provenance-hit"
done

if [ -f "$GITDIR/.provenance-hit" ]; then
    rm -f "$GITDIR/.provenance-hit"
    fail "$WHAT contains a forbidden provenance string.

The matching entries are reported by NUMBER, not quoted: printing them would put
the very names that must appear nowhere in Antarii into your terminal and shell
history — which is rule 7's own reason for keeping the list unpublished.

Check the entry numbers against $LIST, then remove the offending content.
This repository is PUBLIC and its history is protected, so nothing can be removed
from it after the fact."
fi

exit 0
