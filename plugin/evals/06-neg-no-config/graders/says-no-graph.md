---
type: regex
weight: 0.5
arm: with-only
flags: i
match: not_contains
pattern: '(queried|searched|used|using|per|from|according to)\s+(the\s+)?(code[- ]graph|concept graph|graph (search|query|results?))'
target: last_message
---
