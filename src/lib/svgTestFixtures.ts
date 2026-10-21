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

export const SEQ_AUTONUMBER_SVG = `<svg id="fx-seq-num" aria-roledescription="sequence" viewBox="-50 -10 450 453">
<g><line id="actor2" class="actor-line 200" data-et="life-line" data-id="C" x1="250" y1="50" x2="250" y2="326"></line>
<g id="root-2" data-et="participant" data-type="participant" data-id="C"><rect class="actor actor-top" name="C" x="200" y="0" width="100" height="50"></rect><text class="actor actor-box"><tspan>C</tspan></text></g></g>
<g><line id="actor1" class="actor-line 200" data-et="life-line" data-id="B" x1="150" y1="50" x2="150" y2="326"></line>
<g id="root-1" data-et="participant" data-type="participant" data-id="B"><rect class="actor actor-top" name="B" x="100" y="0" width="100" height="50"></rect><text class="actor actor-box"><tspan>B</tspan></text></g></g>
<g><line id="actor0" class="actor-line 200" data-et="life-line" data-id="A" x1="50" y1="50" x2="50" y2="326"></line>
<g id="root-0" data-et="participant" data-type="participant" data-id="A"><rect class="actor actor-top" name="A" x="0" y="0" width="100" height="50"></rect><text class="actor actor-box"><tspan>A</tspan></text></g></g>
<text class="messageText" x="100" y="80">m1</text>
<line class="messageLine0" data-et="message" data-id="i1" data-from="A" data-to="B" x1="50" y1="90" x2="150" y2="90"></line>
<text class="sequenceNumber" x="50" y="94">1</text>
<text class="messageText" x="100" y="130">m2</text>
<line class="messageLine1" data-et="message" data-id="i2" data-from="B" data-to="A" x1="150" y1="140" x2="50" y2="140"></line>
<text class="sequenceNumber" x="150" y="144">2</text>
<text class="messageText" x="50" y="180">m3</text>
<path class="messageLine0" data-et="message" data-id="i3" data-from="A" data-to="A" d="M 50,190 C 110,180 110,220 50,210"></path>
<text class="sequenceNumber" x="50" y="194">3</text>
</svg>`;

export const SEQ_AUTONUMBER_CODE = `sequenceDiagram
    autonumber
    participant A
    participant B
    participant C
    A->>B: m1
    B-->>A: m2
    A->>A: m3`;

// A sequence diagram whose middle message (m:1) has a label that wraps onto
// two rendered text.messageText lines. Mermaid emits one text element per
// wrapped line, stacked consecutively immediately before the message line.
export const SEQ_WRAPPED_SVG = `<svg id="fx-seq-wrapped" aria-roledescription="sequence" viewBox="-50 -10 450 453">
<g><line id="actor1" class="actor-line 200" data-et="life-line" data-id="B" x1="150" y1="50" x2="150" y2="250"></line>
<g id="root-1" data-et="participant" data-type="participant" data-id="B"><rect class="actor actor-top" name="B" x="100" y="0" width="100" height="50"></rect><text class="actor actor-box"><tspan>B</tspan></text></g></g>
<g><line id="actor0" class="actor-line 200" data-et="life-line" data-id="A" x1="50" y1="50" x2="50" y2="250"></line>
<g id="root-0" data-et="participant" data-type="participant" data-id="A"><rect class="actor actor-top" name="A" x="0" y="0" width="100" height="50"></rect><text class="actor actor-box"><tspan>A</tspan></text></g></g>
<defs><marker id="fx-seq-wrapped-arrowhead" refX="7.9" refY="5"><path d="M -1 0 L 10 5 L 0 10 z"></path></marker></defs>
<text class="messageText" x="100" y="80">first</text>
<line class="messageLine0" data-et="message" data-id="i1" data-from="A" data-to="B" x1="50" y1="95" x2="150" y2="95" stroke="none" marker-end="url(#fx-seq-wrapped-arrowhead)"></line>
<text class="messageText" x="100" y="130">a very long message</text>
<text class="messageText" x="100" y="145">that wraps onto two lines</text>
<line class="messageLine1" data-et="message" data-id="i2" data-from="B" data-to="A" x1="150" y1="160" x2="50" y2="160" stroke="none" marker-end="url(#fx-seq-wrapped-arrowhead)"></line>
<text class="messageText" x="100" y="200">last</text>
<line class="messageLine0" data-et="message" data-id="i3" data-from="A" data-to="B" x1="50" y1="215" x2="150" y2="215" stroke="none" marker-end="url(#fx-seq-wrapped-arrowhead)"></line>
</svg>`;

export const SEQ_WRAPPED_CODE = `sequenceDiagram
    participant A
    participant B
    A->>B: first
    B-->>A: a very long message that wraps onto two lines
    A->>B: last`;

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

// Flowchart with one subgraph: nodes A and B are declared inside the "Auth"
// subgraph (one g.cluster), node C is top level. Matches FLOW_SUBGRAPH_CODE.
export const FLOW_SUBGRAPH_SVG = `<svg id="fx-flow" class="flowchart" aria-roledescription="flowchart-v2" viewBox="-8 -8 400 200">
<g class="root">
<g class="clusters"><g class="cluster" id="fx-flow-SG"><rect></rect></g></g>
<g class="edges edgePaths"></g>
<g class="nodes">
<g class="node default" id="fx-flow-flowchart-A-0"><rect class="basic label-container"></rect><g class="label"><foreignObject width="120" height="0"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>A</p></span></div></foreignObject></g></g>
<g class="node default" id="fx-flow-flowchart-B-1"><rect class="basic label-container"></rect><g class="label"><foreignObject width="120" height="0"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>B</p></span></div></foreignObject></g></g>
<g class="node default" id="fx-flow-flowchart-C-2"><rect class="basic label-container"></rect><g class="label"><foreignObject width="120" height="0"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>C</p></span></div></foreignObject></g></g>
</g>
</g>
</svg>`;

export const FLOW_SUBGRAPH_CODE = `flowchart TD
    subgraph Auth
        A
        B
    end
    C`;

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
