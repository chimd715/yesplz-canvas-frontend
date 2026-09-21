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
- Reuse the project's existing dependencies and build tooling. Produce browser-loadable JavaScript and any required CSS; include them in the public build output with the preview page. Do not require the merchant to compile the source.
- Create an ordinary host-page preview that loads the same built widget and tag used by the installation code. Support narrow screens, keyboard interaction and multiple instances without duplicate custom-element registration errors.
- Run the build and check the main interaction. Report any check that could not run.

## APIs and identity, only when required

- Reuse the configured backend stack. Keep credentials on the server and use the real deployed API URL for published widgets.
- Handle cross-origin requests for the intended shop. Never treat a member ID supplied by the browser as verified identity; existing-shop login needs server verification.

## Publication and installation

- Reuse the platform's available Publish flow. Generating code does not establish that publication succeeded.
- After verifying the public asset URL, provide copyable `<script>` plus custom-element installation code matching the emitted files and tag. Resolve dependent assets against the deployed widget location, not the merchant page's origin.
- Do not invent a deployment URL, expose a localhost/private-preview URL as a public installation URL, or claim a shop connection that was not verified. If publishing is unavailable, provide the working build/preview and state the remaining publication step.
- Explain the result and any required merchant action in plain language. Keep engineering details out of routine clarification questions unless the user asks for them.
