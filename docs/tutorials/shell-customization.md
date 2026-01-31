# Shell Customization

EcmaOS provides a flexible shell configuration system that allows for both system-wide defaults and user-specific customizations. Configuration is handled via [TOML](https://toml.io) files.

## Configuration Files

The shell looks for configuration files in the following order:

1.  `/etc/shell.toml`: System-wide default configuration.
2.  `~/.config/shell.toml`: User-specific configuration.

Settings in the user configuration file override the system defaults.

## Configuration Options

Here is a list of available configuration options:

```toml
# Enable or disable the audio bell
noBell = false

# Font configuration
fontFamily = "FiraCode Nerd Font Mono, Ubuntu Mono, courier-new, courier, monospace"
fontSize = 16

# Cursor configuration
cursorBlink = true
cursorStyle = "block" # Options: "block", "underline", "bar"

# Smooth scrolling duration in milliseconds
smoothScrollDuration = 100

# Whether the Option key on Mac should act as Meta
macOptionIsMeta = true
```

## Themes

The shell supports theming via the `theme` configuration block. You can either use a built-in preset or define custom colors.

### Using the theme command

- `theme` - Lists all available themes
- `theme <name>` - Sets the theme to the specified name
- `theme -s <name>` - Sets the theme to the specified name and saves it to the configuration file

### Using Presets

To use a built-in theme, specify the `name` property inside the `[theme]` block:

```toml
[theme]
name = "Dracula"
```

**Available Presets:**
*   Ayu Mirage
*   Catppuccin
*   Challenger Deep
*   Cobalt2
*   Cyberpunk
*   Dracula
*   Everforest
*   Firewatch
*   Gotham
*   Gruvbox
*   Horizon
*   Iceberg
*   Kanagawa
*   Laser
*   Lucario
*   Monokai
*   Night Owl
*   Nord
*   Oceanic Next
*   One Dark
*   Palenight
*   Panda
*   Poimandres
*   Rose Pine
*   Shades of Purple
*   Snazzy
*   Solarized
*   Synthwave
*   Tokyo Night
*   TRS
*   Zenburn

### Custom Colors

You can also define custom colors:

```toml
[theme]
background = "#000000"
foreground = "#00FF00"
promptColor = "green"
```

## Example Configuration

Here is an example `~/.config/shell.toml` that sets the font size to 18 and uses the "Dracula" theme:

```toml
fontSize = 18

[theme]
name = "Dracula"
```
