'use client';

import { ExampleChatInput } from '@/components/paste-attachments/examples/ExampleChatInput';

/**
 * Standalone demo route for the Universal Clipboard Paste Attachment component.
 * Visit `/paste-demo`, focus the input and press Ctrl/Cmd+V. Open the browser
 * console to inspect the parsed attachment metadata returned to the parent.
 */
export default function PasteDemoPage() {
  return (
    <main className="min-h-screen bg-[#0b0b0b] px-4 py-10 text-gray-100">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Universal Clipboard Paste</h1>
          <p className="text-sm text-gray-400">
            Focus the input and press{' '}
            <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-xs">Ctrl / Cmd + V</kbd> to paste
            screenshots, images, video, audio, documents, PDFs, Office files, archives, or plain
            text. Multiple items at once are supported. Open the console to see the attachment
            metadata returned to the parent.
          </p>
        </header>

        <ExampleChatInput />

        <ul className="list-disc space-y-1 pl-5 text-xs text-gray-500">
          <li>Images / screenshots → thumbnail preview</li>
          <li>Video / audio → inline player with duration</li>
          <li>Documents → icon, filename, size, extension</li>
          <li>Plain text → inserted directly, keeping line breaks &amp; spacing</li>
          <li>Oversized / unsupported / duplicate items → inline validation error</li>
        </ul>
      </div>
    </main>
  );
}
