"use client";

export default function GlobalError({ error, reset }) {
  return (
    <html lang="es">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#EBE8E1",
          padding: "2rem",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "420px" }}>
          <p
            style={{
              fontSize: "4rem",
              fontWeight: 700,
              color: "#C9A876",
              margin: 0,
              lineHeight: 1,
            }}
          >
            ALMA
          </p>
          <h2
            style={{
              fontSize: "1.25rem",
              fontWeight: 600,
              color: "#6B5540",
              margin: "1rem 0 0.5rem",
            }}
          >
            Error inesperado
          </h2>
          <p
            style={{
              color: "#A89A87",
              fontSize: "0.9rem",
              margin: "0 0 1.25rem",
            }}
          >
            {error?.message || "Ocurrio un error general en la aplicacion."}
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: "0.5rem 1.5rem",
              background: "#8C6E50",
              color: "#fff",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
              fontSize: "0.9rem",
              fontWeight: 500,
            }}
          >
            Intentar de nuevo
          </button>
        </div>
      </body>
    </html>
  );
}
