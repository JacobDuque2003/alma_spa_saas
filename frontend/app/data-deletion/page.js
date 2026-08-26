import { ContactLine, LegalList, LegalPage, LegalSection } from "../legal-content";

export const metadata = {
  title: "Eliminación de datos — ALMA Spa",
  description: "Instrucciones para solicitar la eliminación de datos registrados en el sistema de ALMA Spa.",
};

export default function DataDeletionPage() {
  return (
    <LegalPage
      eyebrow="Datos personales"
      title="Instrucciones para eliminación de datos"
      description="Aquí se explica cómo una persona puede solicitar que ALMA Spa elimine, corrija o desactive información vinculada a su ficha, reservas o conversaciones."
    >
      <LegalSection title="1. Cómo solicitar la eliminación">
        <p>
          Para solicitar eliminación de datos, envía un correo indicando tu nombre completo, número de WhatsApp o
          teléfono usado en el spa y una descripción clara de la solicitud.
        </p>
        <ContactLine />
      </LegalSection>

      <LegalSection title="2. Qué puedes solicitar">
        <LegalList
          items={[
            "Eliminar o desactivar tu ficha de cliente.",
            "Corregir nombre, teléfono, correo, dirección, número de ficha o cumpleaños.",
            "Eliminar datos que no sean necesarios para la atención.",
            "Solicitar revisión de historial o conversaciones asociadas.",
            "Pedir que no se usen tus datos para recordatorios o mensajes masivos.",
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Verificación de identidad">
        <p>
          Para proteger la privacidad de las personas, ALMA Spa puede pedir confirmación adicional antes de eliminar
          datos. Esto evita que alguien solicite borrar información de otra persona sin autorización.
        </p>
      </LegalSection>

      <LegalSection title="4. Tiempo de respuesta">
        <p>
          ALMA Spa revisará la solicitud y responderá en un plazo razonable. Si la solicitud requiere validación
          adicional, se informará por el mismo canal de contacto.
        </p>
      </LegalSection>

      <LegalSection title="5. Información que podría conservarse">
        <p>
          Algunos registros pueden conservarse cuando sean necesarios por seguridad, auditoría, historial operativo,
          obligaciones administrativas, prevención de fraude o respaldo ante reclamos. En esos casos, se limitará su
          uso y acceso.
        </p>
      </LegalSection>

      <LegalSection title="6. WhatsApp">
        <p>
          Si escribiste por WhatsApp a ALMA Spa, puedes solicitar la eliminación o desvinculación de conversaciones
          dentro del sistema del spa. Ten en cuenta que WhatsApp y Meta pueden conservar información según sus propias
          políticas y configuraciones de la plataforma.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

