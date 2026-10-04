# Mermaid Sequence Diagram Viewer

A full-stack Next.js application designed to manage, visualize, and filter massive Mermaid diagrams (2000+ lines, 50+ flows). The tool acts as a local viewer that allows users to seamlessly switch between `.mmd` files in a directory, selectively hide/show regions (flows, edge cases, notes), and perform custom searches within the rendered diagram.

![Mermaid Viewer Screenshot](./public/screenshot.png)

## Features

- **File Watching & Live Reload**: Automatically updates the diagram within 1 second of saving the file, WITHOUT a full page refresh, retaining the current UI filter state.
- **Agnostic Pre-processor**: Uses custom tagging like `%% @region-start: type=value` to filter regions and smart cleanup to prevent Mermaid from throwing parse errors.
- **Dynamic UI & Filtering**: Sidebar file explorer, URL state persistence for filters, custom search highlighting, and theming.
- **Directory Selection**: You can easily switch between directories via the UI sidebar, or provide a default directory path when starting the app. Recent directories are remembered for quick access.

## How to Run Locally

### 1. Install dependencies

```bash
npm install
```

### 2. Start the development server

You can run the app and pass the directory containing your Mermaid `.mmd` diagrams as a command-line argument:

```bash
npm run dev -- /absolute/path/to/your/diagrams
```

*(If you don't provide a path, it will fall back to the `diagrams` folder in the project root.)*

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result. 

### 3. Change Directory via UI

You can also dynamically load any directory directly from the web interface!
In the sidebar, use the **Directory** section to paste an absolute path to a folder on your system and click **Load Directory**. Your recent directories will be saved for quick access.

## LLM Context File / Skill (Artifact)

This project includes a bundled `diagram-guidelines.md` context file. 
This file acts as the instruction manual you feed to LLMs (like Claude, Gemini, or Codex) so they understand how to generate code compatible with this web app. It explains the custom `%% @region-start` syntax, demonstrates how to correctly nest flows and edge cases, and establishes visual styling rules.
