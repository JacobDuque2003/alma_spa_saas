import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        background: "#EBE8E1",
        padding: "2rem",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: "420px" }}>
        <p
          style={{
            fontSize: "5rem",
            fontWeight: 700,
            color: "#C9A876",
            margin: 0,
            lineHeight: 1,
          }}
        >
          404
        </p>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 600,
            color: "#6B5540",
            margin: "0.75rem 0 0.5rem",
          }}
        >
          Pagina no encontrada
        </h1>
        <p style={{ color: "#A89A87", fontSize: "0.95rem", margin: "0 0 1.5rem" }}>
          La ruta que buscas no existe o fue movida.
        </p>
        <Link
          href="/"
          style={{
            display: "inline-block",
            padding: "0.6rem 1.5rem",
            background: "#8C6E50",
            color: "#fff",
            borderRadius: "0.5rem",
            textDecoration: "none",
            fontSize: "0.9rem",
            fontWeight: 500,
          }}
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
