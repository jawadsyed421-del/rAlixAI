# rAlix AI

Website for **rAlix AI**, an AI & automation studio founded by Rahil Manji and Ali Mehdi Hemani.
We build agents, workflows, websites and apps.

## Highlights
- **Particle portrait hero:** the founders' photo rendered as an interactive 3D point cloud (Three.js) that
  assembles on load, reacts to the cursor, glitches and drifts, and scatters into the starfield on scroll.
- Sections: Ask (brief prompt), Services, Process, Work, Lab (morphing particle cloud), Founders, Contact.
- Motion via GSAP ScrollTrigger: split-text reveals, tilt cards, magnetic buttons, custom cursor, marquee.
- Plain HTML/CSS/JS with no build step. Libraries load from CDNs.

## Run locally
```bash
node serve.mjs
```
Then open http://localhost:5173. Any static server works, but the page must be served over http (not opened as a file)
because it uses ES modules.

## Structure
```
index.html        page markup
css/style.css     styles
js/main.js        page behaviour + config (contact email, photos)
js/particles.js   particle engine (image → 3D point cloud)
assets/           founder photos + cut-out masks (see assets/README.md)
serve.mjs         tiny local static server
```

## To do
- Set the real contact address: `CONTACT_EMAIL` at the top of `js/main.js`.
- Replace the "Selected builds" cards with real case studies.
