# /graph

Query or search the code-graph database.

## Usage

```
/graph <args>...
```

## Routing

Parse `$ARGUMENTS`. Check the first token:

- If first token is one of `concept`, `impact`, `cross`, `vertex` → run:
  ```
  code-graph query <args>
  ```
- Otherwise → run:
  ```
  code-graph search "<args joined as single string>"
  ```

## Exit code handling

After the CLI run, check the exit code:

| Code | Meaning | Suggestion |
|------|---------|-----------|
| `2`  | Server offline | Run `code-graph up` to start the ArangoDB server |
| `3`  | Database missing | Run `code-graph bootstrap` to initialize the database |
| `5`  | No config found | Create a `scribe.config.json` in your project root |
| `6`  | Zero results | Try rephrasing your query, or use the Explore agent for a broader search |

On any other non-zero exit code, surface the raw error output to the user.

On exit code `0`, echo the CLI's markdown output directly into the conversation.

## Examples

```
/graph concept workorder-store
/graph impact useWorkorderActions
/graph cross scheduler-store
/graph vertex resolveWorkorder
/graph "how does drag and drop reorder work?"
```
