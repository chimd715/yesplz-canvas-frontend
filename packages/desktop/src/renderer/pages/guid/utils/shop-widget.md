---
name: shop-widget
description: Build an embeddable shop widget from a plain feature request, including isolated styles, build artifacts, preview and installation code.
---

# Shop Widget

Apply these product-supplied instructions to the user's widget request below.

## Understand the feature

- The user describes the desired feature and appearance. Choose implementation details yourself; do not ask them to specify web components, Shadow DOM, bundlers, filenames or installation syntax.
- Understand the requested feature before asking about integrations. Ask only for missing product or data information that changes the result; otherwise use reasonable defaults.
- Add no database, login, API or connector unless the feature requires it. A static FAQ or size guide can use local content.
- When real store data is needed, clarify which store/data source to use. Keep store-data access separate from storage of new widget data. Label sample data and do not claim it is live.

## Build the deliverable

- Build a reusable custom element. Choose a descriptive hyphenated tag name for the requested feature; `shop-faq` is an example, not a fixed name for every widget.
- Use Shadow DOM to isolate widget styles. Keep styles inside the shadow root and do not alter the host page's global CSS. Shadow DOM is a style boundary, not a security sandbox.
- Create `index.html` at the exact conversation workspace root. It must render the requested widget once, using the same browser-loadable JavaScript and custom-element tag as the installation code. Keep the default page focused on the widget itself: no extra demo cards, multiple-instance examples, installation instructions or separate `preview.html` as the main entry.
- Put the distributable widget JavaScript at the workspace root with a descriptive filename such as `title-widget.js`. The root `index.html` must load `./title-widget.js` and render `<title-widget></title-widget>` (use names matching the actual feature). The public layout is `/` for the preview and `/<widget-name>.js` for shop installation.
- For a plain JavaScript widget, that root JavaScript file can be the source itself. Do not duplicate it just to create a build output or place the only usable entry/assets in an excluded `dist/` or `build/` folder. No package, bundler or build step is needed for this static case.
- When compilation is necessary, reuse existing dependencies and tooling. Keep `package.json` and its real `scripts.build` at the conversation workspace root. Produce browser-loadable JavaScript/CSS and a working root entry; the merchant must not need to compile source.
- Start one loopback preview server with its working directory set to the exact conversation workspace root and serve `index.html` at `/`. Reuse a running server for follow-up edits. Keep it available to the platform's conversation Preview action; do not expose the workspace publicly or request platform credentials.
- Check the main interaction, narrow-screen behavior, keyboard access and repeated instances without duplicate custom-element registration. Test additional instances separately rather than adding them to the default preview. Run a build only when the app requires one, and report any check that could not run.

## APIs and identity, only when required

- Reuse the configured backend stack. Keep credentials on the server and use the real deployed API URL for published widgets.
- Handle cross-origin requests for the intended shop. Never treat a member ID supplied by the browser as verified identity; existing-shop login needs server verification.

## Publication and installation

- Reuse the platform's available Publish flow. Generating code does not establish that publication succeeded.
- After verifying the public asset URL, provide two copyable lines: `<script src="<actual-public-origin>/<widget-name>.js" defer></script>` and `<widget-name></widget-name>`, matching the actual origin, filename and tag. Additional configuration is needed only when the requested feature requires it. Resolve dependent assets against the deployed widget location, not the merchant page's origin.
- Do not invent a deployment URL, expose a localhost/private-preview URL as a public installation URL, or claim a shop connection that was not verified. If publishing is unavailable, provide the working build/preview and state the remaining publication step.
- Explain the result and any required merchant action in plain language. Keep engineering details out of routine clarification questions unless the user asks for them.
