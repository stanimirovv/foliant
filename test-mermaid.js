import mermaid from 'mermaid';
try {
  await mermaid.parse('sequenceDiagram\nbox red\nparticipant A\nend\n');
  console.log("Parse succeeded");
} catch(e) { console.error(e); }
