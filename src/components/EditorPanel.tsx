'use client';

import { ModelElement } from '@/lib/model';

interface EditorPanelProps {
  element: ModelElement | null;   // selected raw element (null = nothing selected)
  warning?: string | null;
  onEditLabel: (newLabel: string) => void;
}

// Properties panel for the structured editor (EDITING_PLAN.md 4.12).
// Walking skeleton (Step 7): only the message/edge Label field — the
// participant/node fields, arrow style fields and add/delete land in Step 8.
export default function EditorPanel({ element, warning, onEditLabel }: EditorPanelProps) {
  return (
    <div className="p-4">
      <h2 className="text-xs font-bold uppercase text-gray-500 mb-2">Editor</h2>
      {!element && (
        <p className="text-xs text-gray-500 italic">
          Click an element in the diagram to edit it.
        </p>
      )}
      {element && (element.kind === 'message' || element.kind === 'edge') && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-400 block">
            {element.kind === 'message' ? 'Message' : 'Edge'} Label
          </label>
          <input
            type="text"
            className="w-full px-2 py-1 text-sm border rounded bg-gray-50   focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={element.label ?? ''}
            onChange={(e) => onEditLabel(e.target.value)}
          />
        </div>
      )}
      {element && element.kind !== 'message' && element.kind !== 'edge' && (
        <p className="text-xs text-gray-500 italic">
          {(element.kind === 'participant' || element.kind === 'node')
            ? 'Participant editing is coming in the next step.'
            : 'This element is not editable yet.'}
        </p>
      )}
      {warning && (
        <p className="text-xs text-yellow-600 mt-2">{warning}</p>
      )}
    </div>
  );
}
