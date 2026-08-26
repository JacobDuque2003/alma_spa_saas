import { ContactLine, LegalList, LegalPage, LegalSection } from "../legal-content";

export const metadata = {
  title: "Política de privacidad — ALMA Spa",
  description: "Política de privacidad de ALMA Spa y su sistema de reservas, clientes y mensajería.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacidad"
      title="Política de privacidad"
      description="Esta política explica cómo ALMA Spa gestiona la información necesaria para atender reservas, clientes, historial de servicios y comunicaciones por WhatsApp."
    >
      <LegalSection title="1. Responsable del tratamiento">
        <p>
          ALMA Spa utiliza este sistema para administrar su operación interna: reservas, agenda, clientes,
          historial de atención, recordatorios y comunicación relacionada con los servicios del spa.
        </p>
        <ContactLine />
      </LegalSection>

      <LegalSection title="2. Información que podemos registrar">
        <LegalList
          items={[
            "Nombre de la clienta o cliente.",
            "Número de teléfono o WhatsApp.",
            "Correo electrónico, si la persona lo proporciona.",
            "Dirección o referencia, si se registra para atención o seguimiento.",
            "Número de ficha interna del spa.",
            "Fecha de cumpleaños, si se entrega para recordatorios o cortesías.",
            "Reservas, horarios, cabina asignada, terapeuta y servicio solicitado.",
            "Indicaciones necesarias para preparar la cita.",
            "Historial de tratamientos y observaciones registradas por el equipo autorizado.",
            "Datos de anamnesis o antecedentes clínicos marcados por la clienta o el equipo autorizado.",
            "Movimientos de cuenta relacionados con abonos, cargos, saldos o paquetes.",
            "Mensajes de WhatsApp vinculados con reservas, confirmaciones o atención al cliente.",
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Para qué usamos la información">
        <p>La información se usa únicamente para fines relacionados con la atención y operación de ALMA Spa:</p>
        <LegalList
          items={[
            "Crear, confirmar, mover o cancelar reservas.",
            "Asignar cabinas y terapeutas según disponibilidad.",
            "Evitar cruces de horario y mejorar la organización diaria.",
            "Consultar historial antes de atender a una clienta.",
            "Enviar recordatorios o respuestas por WhatsApp cuando corresponda.",
            "Registrar pagos, abonos o cargos del cliente.",
            "Generar reportes internos del negocio.",
            "Mantener seguridad, auditoría y control de accesos dentro del sistema.",
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Datos sensibles y acceso limitado">
        <p>
          La ficha de anamnesis puede contener datos sensibles de salud o antecedentes clínicos. Esta información
          se limita al personal autorizado y se protege con controles de acceso. El sistema registra auditoría de
          accesos y cambios para mantener trazabilidad.
        </p>
      </LegalSection>

      <LegalSection title="5. WhatsApp y Meta">
        <p>
          Si una persona escribe al número de WhatsApp de ALMA Spa o recibe mensajes relacionados con una reserva,
          el sistema puede procesar datos técnicos enviados por WhatsApp Business Platform, como número de teléfono,
          nombre de perfil, identificador del mensaje, contenido del mensaje, estado de entrega y hora del evento.
        </p>
        <p>
          Estos datos se usan para responder solicitudes, registrar conversaciones, enviar confirmaciones o mantener
          el historial de atención. ALMA Spa no vende estos datos ni los comparte con terceros para publicidad.
        </p>
      </LegalSection>

      <LegalSection title="6. Conservación de la información">
        <p>
          La información se conserva mientras sea necesaria para operar el servicio, mantener historial de atención,
          cumplir obligaciones administrativas, resolver solicitudes o conservar registros de seguridad y auditoría.
        </p>
      </LegalSection>

      <LegalSection title="7. Seguridad">
        <p>
          El sistema utiliza autenticación, permisos por rol, separación por negocio, controles de acceso, auditoría
          y protección de credenciales. Los datos sensibles de anamnesis y ciertas credenciales de integración se
          manejan con protección adicional.
        </p>
      </LegalSection>

      <LegalSection title="8. Derechos de las personas">
        <p>
          Puedes solicitar acceso, corrección, actualización, desactivación o eliminación de tus datos, según
          corresponda y de acuerdo con las obligaciones operativas o legales aplicables.
        </p>
        <ContactLine />
      </LegalSection>
    </LegalPage>
  );
}

