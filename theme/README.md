# Tarter brand theme

`tarter-brand-theme.css` is the shared visual layer: brand tokens (Tarter red,
graphite surfaces, elevation, motion) plus component styling on top of whatever
CSS the target build already ships. It never changes markup or behaviour, so it
can be dropped on a build without re-testing its logic.

Two targets, because the app exists in two shapes:

| Build | How the theme ships |
| --- | --- |
| Repo app (`/index.html` + `/enhancements.*`) | `tarter-theme.css`, linked after the inline `<style>` |
| Single-file V2.3.2 "Local Operations" build (Control Center, nav rail) | injected inline by `build.py` |

## Re-theming a single-file build

```
python3 theme/build.py path/to/source-index.html path/to/output-index.html
```

The script strips any `<style id="tarter-brand-theme">` it already finds, then
injects the current CSS before the **last** `</body>`. That anchor matters: the
embedded SheetJS library contains a `"</body></html>"` string literal, and
injecting at the first match lands inside JavaScript and breaks the parse of the
whole script element.

## Colour roles

Keep these apart when adding UI:

- **brand red** — identity, primary/commit actions, active navigation, selected settings
- **amber** — attention and editing state (new reports, map handles, warnings)
- **green** — resolved / verified
- **blue** — informational
