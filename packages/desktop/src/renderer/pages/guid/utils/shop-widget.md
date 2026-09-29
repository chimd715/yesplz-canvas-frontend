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

## Confirm the data source before implementation

- For a widget that needs store or product data, confirm the store and data source before writing code. A request such as "Make a similar-product carousel for my shop" does not identify its data source.
- If the source is not already confirmed in the conversation, ask one concise question and wait for the user's answer. Do not write or modify widget files, scaffold a project, install dependencies or start a preview before that answer. Automatic tool permissions do not resolve this product decision.
- When the store platform is unknown, ask "Which platform is your store on?" with exactly two initial choices: `Shopify` and `Other`. Use the available question UI when supported; otherwise ask in chat and end the turn. Keep these option labels fixed; do not add sample products as a third initial choice.
- For `Shopify`, clarify which store/authorized connection to use and guide any missing connection through the available connector. For `Other`, ask which shop or existing product-data source to use, requesting only the information needed to proceed. Platform selection alone does not confirm that a data connection exists. Do not ask the merchant to choose an API protocol or provide secrets in chat.
- Reuse a source already confirmed in the conversation. Do not repeat this question for static FAQ/size-guide content or when the user explicitly requested a sample-data preview.
- Use sample products only when the user explicitly chooses them. Keep the product catalog source separate from the recommendation service; a shop connection does not prove that recommendations are available. Do not present random or hardcoded products as verified similar recommendations.
- After the answer, use verified available connections/tools and explain any missing connection step. Do not claim access to shop products or a recommendation API without evidence.

## Keep the data source replaceable

- Keep rendering separate from product/recommendation reads. Use a small data-access function or module; do not introduce a provider framework or registry for one source.
- Keep the selected store and API endpoint in replaceable configuration rather than buried in rendering code. A source change may require changing the data-access mapping, but must not require rewriting the widget UI. Keep credentials on the trusted server, outside widget source and public configuration.
- For future sharing or remix, reusable code must not include owner authorization bindings, credentials or private shop data. A different owner must select or connect their own authorized source before using live data. Do not claim that sharing, remix or automatic rebinding is implemented by these instructions.

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
