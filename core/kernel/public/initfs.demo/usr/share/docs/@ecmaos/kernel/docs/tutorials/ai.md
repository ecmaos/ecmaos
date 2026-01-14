# @ecmaos-apps/ai

The `@ecmaos-apps/ai` app provides a command-line interface for interacting with OpenAI-compatible APIs from the ecmaOS terminal.

## Installation

```bash
# install @ecmaos-apps/ai
```

## Configuration

### API Key

Set your API key using one of these methods:

**Persistent (recommended)**: Add to `~/.env`:

```bash
echo 'OPENAI_API_KEY=sk-your-api-key-here' >> ~/.env
```

**Session-only**: Use the `env` command:

```bash
env set OPENAI_API_KEY "sk-your-api-key-here"
```

**Per-command**: Use the `--key` option:

```bash
ai --key "sk-your-api-key-here" "Your prompt"
```

### Optional Settings

Add to `~/.env` for persistence:

```text
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=openai/gpt-4o
```

## Usage

### Basic

```bash
ai "Tell me a joke"
echo "Explain quantum computing" | ai
cat prompt.txt | ai
```

### Sessions

Use `--session` to maintain conversation context:

```bash
ai --session coding "I'm learning JavaScript"
ai --session coding "Explain closures"
ai --session coding "Show me an example"
```

Sessions are stored in `~/.cache/ai/sessions/<session-name>/session.json`.

### Options

- `--model`: Specify model (default: `gpt-4o`)
- `--max`: Max messages in session (default: 50, older messages are compressed)
- `--no-stream`: Disable streaming output
- `--url`: Custom API endpoint (default: `https://api.openai.com/v1`)
- `--session`: Session name for conversation continuity

### Examples

```bash
# Quick question
ai "What is async/await?"

# Multi-turn conversation
ai --session help "Explain promises"
ai --session help "How do I chain them?"

# Using OpenRouter
env set OPENAI_BASE_URL "https://openrouter.ai/api/v1"
env set OPENAI_API_KEY "sk-or-v1-xxx"
ai --model "openai/gpt-4o" "Your prompt"

# Non-streaming for scripts
ai --no-stream "Generate JSON" > output.json

# Pipeline usage
ai "List languages" | grep -i python
```

## Command Reference

```text
Usage: ai [options] [prompt]

Options:
  --help       Show help
  --key        API key (default: OPENAI_API_KEY env var)
  --max        Max messages in session (default: 50)
  --model      Model to use (default: gpt-4o)
  --no-stream  Disable streaming
  --session    Session name (default: random)
  --url        API base URL (default: https://api.openai.com/v1)

Environment Variables:
  OPENAI_API_KEY   API key (required)
  OPENAI_BASE_URL  API base URL
  OPENAI_MODEL     Default model
```
