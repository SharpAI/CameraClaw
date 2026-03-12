#!/bin/bash
# CameraClaw Desktop Setup — Windows-like XFCE4 configuration
# This script runs inside the Docker container at build time to pre-configure
# the desktop environment with Windows-like behavior and appearance.
#
# Key Windows behaviors:
#   1. Bottom panel with Start menu (Whisker Menu), taskbar, system tray, clock
#   2. Window controls (close/maximize/minimize) on the RIGHT side
#   3. Windows 10 GTK theme (B00merang)
#   4. Desktop icons enabled (for OpenClaw shortcut)
#   5. Single-click taskbar behavior

set -e

TARGET_HOME="${1:-/home/node}"

echo "🎨 Setting up Windows-like desktop for $TARGET_HOME..."

# ── XFCE4 Panel Configuration ──────────────────────────────────────────────
# Bottom panel: Whisker Menu | Window Buttons (taskbar) | Separator | Systray | Clock

mkdir -p "$TARGET_HOME/.config/xfce4/xfconf/xfce-perchannel-xml"
mkdir -p "$TARGET_HOME/.config/xfce4/panel"
mkdir -p "$TARGET_HOME/Desktop"

# Main XFCE4 panel config
cat > "$TARGET_HOME/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml" << 'PANELXML'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-panel" version="1.0">
  <property name="configver" type="int" value="2"/>
  <property name="panels" type="array">
    <value type="int" value="1"/>
  </property>
  <property name="panels" type="empty">
    <property name="panel-1" type="empty">
      <property name="position" type="string" value="p=8;x=0;y=0"/>
      <property name="length" type="uint" value="100"/>
      <property name="position-locked" type="bool" value="true"/>
      <property name="size" type="uint" value="36"/>
      <property name="plugin-ids" type="array">
        <value type="int" value="1"/>
        <value type="int" value="2"/>
        <value type="int" value="3"/>
        <value type="int" value="4"/>
        <value type="int" value="5"/>
        <value type="int" value="6"/>
      </property>
      <property name="background-style" type="uint" value="0"/>
      <property name="enter-opacity" type="uint" value="100"/>
      <property name="leave-opacity" type="uint" value="100"/>
    </property>
  </property>
  <property name="plugins" type="empty">
    <property name="plugin-1" type="string" value="applicationsmenu">
      <property name="button-icon" type="string" value="start-here"/>
      <property name="button-title" type="string" value="Start"/>
      <property name="show-button-title" type="bool" value="true"/>
      <property name="show-tooltips" type="bool" value="true"/>
    </property>
    <property name="plugin-2" type="string" value="separator">
      <property name="style" type="uint" value="0"/>
    </property>
    <property name="plugin-3" type="string" value="tasklist">
      <property name="flat-buttons" type="bool" value="true"/>
      <property name="show-handle" type="bool" value="false"/>
      <property name="show-labels" type="bool" value="true"/>
      <property name="grouping" type="uint" value="1"/>
      <property name="window-scrolling" type="bool" value="false"/>
    </property>
    <property name="plugin-4" type="string" value="separator">
      <property name="expand" type="bool" value="true"/>
      <property name="style" type="uint" value="0"/>
    </property>
    <property name="plugin-5" type="string" value="systray">
      <property name="known-legacy-items" type="array">
        <value type="string" value="task manager"/>
      </property>
    </property>
    <property name="plugin-6" type="string" value="clock">
      <property name="digital-format" type="string" value="%I:%M %p"/>
      <property name="mode" type="uint" value="2"/>
    </property>
  </property>
</channel>
PANELXML

# ── Window Manager Settings (buttons on RIGHT, Windows-like) ───────────────

cat > "$TARGET_HOME/.config/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml" << 'WFMXML'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfwm4" version="1.0">
  <property name="general" type="empty">
    <!-- Window buttons: title on left, minimize/maximize/close on right (Windows-style) -->
    <property name="button_layout" type="string" value="O|HMC"/>
    <property name="title_alignment" type="string" value="left"/>
    <property name="theme" type="string" value="Default"/>
    <property name="snap_to_border" type="bool" value="true"/>
    <property name="snap_to_windows" type="bool" value="true"/>
    <property name="snap_width" type="int" value="10"/>
    <property name="wrap_windows" type="bool" value="false"/>
    <property name="workspace_count" type="int" value="1"/>
    <property name="placement_ratio" type="int" value="20"/>
    <property name="placement_mode" type="string" value="center"/>
  </property>
</channel>
WFMXML

# ── Desktop Settings ──────────────────────────────────────────────────────

cat > "$TARGET_HOME/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-desktop.xml" << 'DESKXML'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-desktop" version="1.0">
  <property name="desktop-icons" type="empty">
    <property name="style" type="int" value="2"/>
    <property name="file-icons" type="empty">
      <property name="show-home" type="bool" value="false"/>
      <property name="show-filesystem" type="bool" value="false"/>
      <property name="show-removable" type="bool" value="false"/>
      <property name="show-trash" type="bool" value="false"/>
    </property>
    <property name="icon-size" type="uint" value="48"/>
  </property>
  <property name="backdrop" type="empty">
    <property name="screen0" type="empty">
      <property name="monitorscreen" type="empty">
        <property name="workspace0" type="empty">
          <property name="color-style" type="int" value="0"/>
          <property name="rgba1" type="array">
            <value type="double" value="0.121569"/>
            <value type="double" value="0.160784"/>
            <value type="double" value="0.215686"/>
            <value type="double" value="1.000000"/>
          </property>
          <property name="image-style" type="int" value="0"/>
        </property>
      </property>
    </property>
  </property>
</channel>
DESKXML

# ── Session Settings (disable screen lock, power manager) ─────────────────

cat > "$TARGET_HOME/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-session.xml" << 'SESSXML'
<?xml version="1.0" encoding="UTF-8"?>
<channel name="xfce4-session" version="1.0">
  <property name="general" type="empty">
    <property name="SaveOnExit" type="bool" value="false"/>
    <property name="AutoSave" type="bool" value="false"/>
  </property>
</channel>
SESSXML

# ── Terminal Settings ─────────────────────────────────────────────────────

mkdir -p "$TARGET_HOME/.config/xfce4/terminal"
cat > "$TARGET_HOME/.config/xfce4/terminal/terminalrc" << 'TERMRC'
[Configuration]
FontName=Monospace 11
MiscShowUnsafePasteDialog=FALSE
ColorBackground=#1e1e2e
ColorForeground=#cdd6f4
TERMRC

echo "✅ Desktop configuration complete"
