use zed_extension_api as zed;

struct CodeGraphExtension;

impl zed::Extension for CodeGraphExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        // Allow override via Zed lsp settings:
        //   "lsp": { "code-graph-lsp": { "binary": { "path": "...", "arguments": [...] } } }
        if let Ok(settings) =
            zed::settings::LspSettings::for_worktree("code-graph-lsp", worktree)
        {
            if let Some(binary) = settings.binary {
                if let Some(path) = binary.path {
                    return Ok(zed::Command {
                        command: path,
                        args: binary.arguments.unwrap_or_default(),
                        env: Default::default(),
                    });
                }
            }
        }

        // Resolve `code-graph-lsp` from worktree shell PATH. The pnpm-linked
        // entry is a shell wrapper that already invokes node with the right
        // server.js, so we exec it directly (no `node <path>` wrapper).
        let server = worktree
            .which("code-graph-lsp")
            .ok_or_else(|| {
                "code-graph-lsp not found on worktree PATH \
                 — run `just lsp-link` or set lsp.code-graph-lsp.binary in Zed settings"
                    .to_string()
            })?;

        Ok(zed::Command {
            command: server,
            args: vec![],
            env: Default::default(),
        })
    }
}

zed::register_extension!(CodeGraphExtension);
