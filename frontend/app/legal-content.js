import Link from "next/link";

const LAST_UPDATED = "26 de agosto de 2026";

export function LegalPage({ eyebrow, title, description, children }) {
  return (
    <main className="min-h-screen bg-[#EBE8E1] px-5 py-8 text-[#3A2F26] sm:px-8 lg:px-10">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="rounded-[2rem] border border-[#DDD6CC] bg-[#FAF7F2]/95 p-6 shadow-[0_24px_70px_rgba(107,85,64,0.12)] sm:p-8">
          <Link
            href="/reservar/alma-spa"
            className="mb-8 inline-flex rounded-full border border-[#DDD6CC] bg-white/55 px-4 py-2 text-sm font-semibold text-[#8C6E50] transition hover:-translate-y-0.5 hover:border-[#C9A876]"
          >
            Volver a Alma Spa
          </Link>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#C9A876]">{eyebrow}</p>
          <h1 className="mt-3 font-heading text-4xl font-semibold leading-tight text-[#6B5540] sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-[#7A6A59]">{description}</p>
          <p className="mt-6 text-sm text-[#A89A87]">Última actualización: {LAST_UPDATED}</p>
        </header>

        <article className="rounded-[2rem] border border-[#DDD6CC] bg-[#FAF7F2]/90 p-6 shadow-[0_18px_55px_rgba(107,85,64,0.08)] sm:p-8">
          <div className="space-y-8">{children}</div>
        </article>

        <footer className="pb-4 text-center text-sm text-[#8C6E50]">
          ALMA Spa · Belleza y bienestar holístico
        </footer>
      </section>
    </main>
  );
}

export function LegalSection({ title, children }) {
  return (
    <section className="rounded-3xl border border-[#DDD6CC] bg-white/45 p-5">
      <h2 className="font-heading text-2xl font-semibold text-[#6B5540]">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-[#665545] sm:text-base">{children}</div>
    </section>
  );
}

export function LegalList({ items }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item} className="rounded-2xl border border-[#E7DED2] bg-[#FAF7F2] px-4 py-3">
          {item}
        </li>
      ))}
    </ul>
  );
}

export function ContactLine() {
  return (
    <p>
      Para consultas, solicitudes o eliminación de información, comunícate con ALMA Spa por sus medios oficiales de
      atención. Cuando el spa confirme su número y canal definitivo, esta página podrá actualizarse con esa información.
    </p>
  );
}
