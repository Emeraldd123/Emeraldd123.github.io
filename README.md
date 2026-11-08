# Ben Kadison: portfolio

Personal site: neuroscience research and the software I build (MindCode, Pipit Notes, The Ben Times, NFL Edge, the agent board).

- Plain HTML/CSS/JS in `index.html`, no build step. Screenshots are in `assets/`.
- An interactive "constellation" maps projects, research and skills (hover to trace connections, click to jump).
- The "Lately on GitHub" section loads live public activity from the GitHub API, with a static fallback.

## Run locally

Open `index.html` in a browser, or:

```bash
python -m http.server 8000
```

## Deploy (GitHub Pages)

1. Push this folder to a public repo named `Emeraldd123.github.io`.
2. Settings → Pages → Deploy from branch → `main` / root.
3. The site goes live at https://emeraldd123.github.io.
