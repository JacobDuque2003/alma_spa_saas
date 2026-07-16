"use client";

export default function Error({ error, reset }) {
  return (
    <div
      style={{
        minHeight: "50vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: "420px" }}>
        <div
          style={{
            width: "3rem",
            height: "3rem",
            margin: "0 auto 1rem",
            borderRadius: "50%",
            background: "#EBCDB5",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.25rem",
            color: "#8C6E50",
          }}
        >
          !
        </div>
        <h2
          style={{
            fontSize: "1.25rem",
            fontWeight: 600,
            color: "#6B5540",
            margin: "0 0 0.5rem",
          }}
        >
          Algo salio mal
        </h2>
        <p
          style={{
            color: "#A89A87",
            fontSize: "0.9rem",
            margin: "0 0 1.25rem",
          }}
        >
          {error?.message || "Ocurrio un error inesperado en esta seccion."}
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
    </div>
  );
}
