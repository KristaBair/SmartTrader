// Renders the shared Terms and Conditions text. Used by the public /terms page,
// the acceptance screen, and anywhere else the full terms need to be shown.

import { TERMS_EFFECTIVE_DATE, TERMS_SECTIONS, SERVICE_NAME } from "@shared/terms";

// Turns bare URLs in the terms into links that open in a new tab.
function linkify(text: string) {
  return text.split(/(https:\/\/[^\s)]+)/g).map((part, index) =>
    part.startsWith("https://") ? (
      <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
        {part}
      </a>
    ) : (
      part
    )
  );
}

export default function TermsContent() {
  return (
    <article className="space-y-6 text-sm leading-6 text-gray-700">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">{SERVICE_NAME} Terms and Conditions</h1>
        <p className="mt-1 text-gray-500">Effective {TERMS_EFFECTIVE_DATE}</p>
      </header>
      {TERMS_SECTIONS.map((section) => (
        <section key={section.id} id={section.id} className="space-y-2">
          <h2 className="text-base font-semibold text-gray-900">{section.title}</h2>
          {section.blocks.map((block, index) =>
            Array.isArray(block) ? (
              <ul key={index} className="list-disc space-y-1 pl-5">
                {block.map((item) => <li key={item}>{linkify(item)}</li>)}
              </ul>
            ) : (
              <p key={index}>{linkify(block)}</p>
            )
          )}
        </section>
      ))}
    </article>
  );
}
