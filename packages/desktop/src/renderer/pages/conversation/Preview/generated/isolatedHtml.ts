/** Static document HTML: no scripts, navigation, network or parent privileges. */
export const GENERATED_HTML_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";

export function isolateGeneratedHtml(content: string): string {
  // Template contents have no browsing context. DOMParser may fetch image/frame
  // resources before a policy is inserted, so never parse untrusted HTML there.
  const template = document.createElement('template');
  template.innerHTML = content;
  // An output cannot replace the policy or resolve relative resources against our app.
  template.content
    .querySelectorAll('base, meta[http-equiv], script, iframe, frame, object, embed')
    .forEach((element) => element.remove());
  template.content.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || ['action', 'formaction', 'ping', 'target', 'download', 'srcdoc'].includes(name))
        element.removeAttribute(attribute.name);
      if ((name === 'href' || name === 'xlink:href') && !attribute.value.startsWith('#'))
        element.removeAttribute(attribute.name);
    }
  });
  const policy = document.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', GENERATED_HTML_CSP);
  return `<!doctype html><html><head>${policy.outerHTML}</head><body>${template.innerHTML}</body></html>`;
}
