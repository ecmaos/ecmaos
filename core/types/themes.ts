
import { ShellConfig } from './shell.js'

/**
 * Terminal theme presets
 */
export const ThemePresets: Record<string, NonNullable<ShellConfig['theme']>> = {
  'Ayu Mirage': { background: '#1f2430', foreground: '#cbccc6', promptColor: '#ffcc66' },
  'Catppuccin': { background: '#1e1e2e', foreground: '#cdd6f4', promptColor: '#cba6f7' },
  'Challenger Deep': { background: '#1e1c31', foreground: '#cbe3e7', promptColor: '#95ffa4' },
  'Cobalt2': { background: '#193549', foreground: '#ffffff', promptColor: '#ffc600' },
  'Cyberpunk': { background: '#020202', foreground: '#00ff9f', promptColor: '#fdf500' },
  'Dracula': { background: '#282a36', foreground: '#f8f8f2', promptColor: '#ff79c6' },
  'Everforest': { background: '#272e33', foreground: '#d3c6aa', promptColor: '#a7c080' },
  'Firewatch': { background: '#2d2022', foreground: '#dddddd', promptColor: '#dba67d' },
  'Gotham': { background: '#0a0f14', foreground: '#98d1ce', promptColor: '#26a98b' },
  'Gruvbox': { background: '#282828', foreground: '#ebdbb2', promptColor: '#fe8019' },
  'Horizon': { background: '#1c1e26', foreground: '#d5d8da', promptColor: '#e95678' },
  'Iceberg': { background: '#161821', foreground: '#c6c8d1', promptColor: '#84a0c6' },
  'Kanagawa': { background: '#1F1F28', foreground: '#DCD7BA', promptColor: '#7E9CD8' },
  'Laser': { background: '#27212e', foreground: '#e4e4e4', promptColor: '#ff3d81' },
  'Lucario': { background: '#2b3e50', foreground: '#f8f8f2', promptColor: '#ff6541' },
  'Monokai': { background: '#2d2a2e', foreground: '#fcfcfa', promptColor: '#ff6188' },
  'Night Owl': { background: '#011627', foreground: '#d6deeb', promptColor: '#addb67' },
  'Nord': { background: '#2e3440', foreground: '#d8dee9', promptColor: '#88c0d0' },
  'Oceanic Next': { background: '#1b2b34', foreground: '#d8dee9', promptColor: '#6699cc' },
  'One Dark': { background: '#282c34', foreground: '#abb2bf', promptColor: '#61afef' },
  'Palenight': { background: '#292d3e', foreground: '#a6accd', promptColor: '#c792ea' },
  'Panda': { background: '#292a2b', foreground: '#e6e6e6', promptColor: '#ff75b5' },
  'Poimandres': { background: '#1b1e28', foreground: '#a6accd', promptColor: '#5de4c7' },
  'Rose Pine': { background: '#191724', foreground: '#e0def4', promptColor: '#ebbcba' },
  'Shades of Purple': { background: '#2d2b55', foreground: '#ffffff', promptColor: '#fad000' },
  'Snazzy': { background: '#282a36', foreground: '#eff0eb', promptColor: '#ff5c57' },
  'Solarized': { background: '#002b36', foreground: '#839496', promptColor: '#268bd2' },
  'Synthwave': { background: '#262335', foreground: '#ffffff', promptColor: '#ff7edb' },
  'Tokyo Night': { background: '#1a1b26', foreground: '#c0caf5', promptColor: '#7aa2f7' },
  'TRS': { background: '#000000', foreground: '#00FF00', promptColor: '#00FF00' },
  'Zenburn': { background: '#3f3f3f', foreground: '#dcdccc', promptColor: '#cc9393' },
}
