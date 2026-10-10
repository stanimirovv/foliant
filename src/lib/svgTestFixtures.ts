// Hand-written SVG fixtures for svgmap/styling tests. They mirror the
// confirmed Mermaid 12.1 render structure (see svgmap.ts header); sequence
// participants are intentionally in reversed DOM order, as mermaid emits
// them right-to-left.

export const SEQ_SVG = `<svg id="fx-seq" aria-roledescription="sequence" viewBox="-50 -10 450 453">
<g><rect x="200" y="326" class="actor actor-bottom" name="C"></rect><text class="actor actor-box"><tspan>C</tspan></text></g>
<g><rect x="0" y="326" class="actor actor-bottom" name="A"></rect><text class="actor actor-box"><tspan>A</tspan></text></g>
<g><line id="actor2" class="actor-line 200" data-et="life-line" data-id="C"></line>
<g id="root-2" data-et="participant" data-type="participant" data-id="C"><rect class="actor actor-top" name="C"></rect><text class="actor actor-box"><tspan>C</tspan></text></g></g>
<g><line id="actor1" class="actor-line 200" data-et="life-line" data-id="B"></line>
<g id="root-1" data-et="participant" data-type="participant" data-id="B"><rect class="actor actor-top" name="B"></rect><text class="actor actor-box"><tspan>B</tspan></text></g></g>
<g><line id="actor0" class="actor-line 200" data-et="life-line" data-id="A"></line>
<g id="root-0" data-et="participant" data-type="participant" data-id="A"><rect class="actor actor-top" name="A"></rect><text class="actor actor-box"><tspan>A</tspan></text></g></g>
<defs><marker id="fx-seq-arrowhead" refX="7.9" refY="5"><path d="M -1 0 L 10 5 L 0 10 z"></path></marker></defs>
<g data-et="note" data-id="i3"><rect class="note"></rect><text class="noteText">Shared</text></g>
<text class="messageText">m1</text>
<line class="messageLine0" data-et="message" data-id="i1" data-from="A" data-to="B" stroke="none" marker-end="url(#fx-seq-arrowhead)"></line>
<text class="messageText">m2</text>
<line class="messageLine1" data-et="message" data-id="i2" data-from="B" data-to="A" stroke="none" marker-end="url(#fx-seq-arrowhead)"></line>
<text class="messageText">m3</text>
<path class="messageLine0" data-et="message" data-id="i4" data-from="A" data-to="A" stroke="none" marker-end="url(#fx-seq-arrowhead)"></path>
<text class="messageText">m4</text>
<line class="messageLine0" data-et="message" data-id="i5" data-from="A" data-to="C" stroke="none" marker-end="url(#fx-seq-arrowhead)"></line>
<g class="actor-man actor-bottom" name="B"><text class="actor actor-man"><tspan>B</tspan></text></g>
</svg>`;

export const SEQ_CODE = `sequenceDiagram
    participant A
    participant B
    participant C
    A->>B: m1
    B-->>A: m2
    Note over A,C: Shared
    A->>A: m3
    A->>C: m4`;

export const FLOW_SVG = `<svg id="fx-flow" class="flowchart" aria-roledescription="flowchart-v2" viewBox="-8 -8 116 36">
<g><marker id="fx-flow_flowchart-v2-pointEnd-margin" class="marker flowchart-v2"><path class="arrowMarkerPath" d="M 0 0 L 11.5 7 L 0 14 z"></path></marker>
<g class="root">
<g class="clusters"><g class="cluster" id="fx-flow-SG"><rect></rect></g></g>
<g class="edges edgePaths">
<path id="fx-flow-L_A_B_0" class="flowchart-link" data-edge="true" data-et="edge" data-id="L_A_B_0" marker-end="url(#fx-flow_flowchart-v2-pointEnd-margin)"></path>
<path id="fx-flow-L_B_C_0" class="flowchart-link" data-edge="true" data-et="edge" data-id="L_B_C_0" marker-end="url(#fx-flow_flowchart-v2-pointEnd-margin)"></path>
</g>
<g class="edgeLabels">
<g class="edgeLabel" transform="translate(82, 82)"><g class="label" data-id="L_B_C_0"><foreignObject width="0" height="0"><div xmlns="http://www.w3.org/1999/xhtml"><span class="edgeLabel"><p>Reply</p></span></div></foreignObject></g></g>
</g>
<g class="nodes">
<g class="node default" id="fx-flow-flowchart-A-0"><rect class="basic label-container"></rect><g class="label"><foreignObject width="120" height="0"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>Alice</p></span></div></foreignObject></g></g>
<g class="node default" id="fx-flow-flowchart-B-1"><rect class="basic label-container"></rect><g class="label"><foreignObject width="120" height="0"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>Bob</p></span></div></foreignObject></g></g>
<g class="node default" id="fx-flow-flowchart-C-7"><polygon class="label-container" points="75,0 150,-75 75,-150 0,-75"></polygon><g class="label"><foreignObject width="120" height="0"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>Charlie</p></span></div></foreignObject></g></g>
</g>
</g></g>
</svg>`;

export const FLOW_CODE = `flowchart TD
    A[Alice] --> B[Bob]
    B -->|Reply| C[Charlie]`;

export function parseSvgRoot(svg: string): Element {
  const doc = new DOMParser().parseFromString(svg, 'text/html');
  const root = doc.querySelector('svg');
  if (!root) throw new Error('fixture did not parse');
  return root;
}

// jsdom's CSSOM normalizes hex colors to rgb(); named colors pass through.
export function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

export const styleOf = (el: Element | null) => (el as unknown as SVGElement).style;
