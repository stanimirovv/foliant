// jsdom does not implement the SVG geometry APIs that mermaid.render needs.
// Polyfill them with fixed geometry so render-level tests can run (the plan's
// render-level assertions are attribute-level; pixel-perfect layout checks are
// reserved for Cypress).
if (typeof SVGElement !== 'undefined') {
  // getBBox lives on SVGGraphicsElement in lib.dom; the polyfill targets SVGElement.
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = function getBBox() {
    return { x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, toJSON: () => ({}) } as DOMRect;
  };
  (SVGElement.prototype as unknown as { getComputedTextLength: () => number }).getComputedTextLength = function getComputedTextLength() {
    return 100;
  };
}
