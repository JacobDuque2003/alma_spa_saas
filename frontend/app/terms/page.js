import { ContactLine, LegalList, LegalPage, LegalSection } from "../legal-content";

export const metadata = {
  title: "Términos del servicio — ALMA Spa",
  description: "Términos de uso del sistema de reservas, clientes y mensajería de ALMA Spa.",
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Condiciones"
      title="Términos del servicio"
      description="Estos términos describen el uso del sistema digital de ALMA Spa para reservas, agenda, clientes, comunicación y administración interna."
    >
      <LegalSection title="1. Alcance del sistema">
        <p>
          El sistema de ALMA Spa permite gestionar reservas, clientes, cabinas, servicios, historial de atención,
          permisos del equipo, reportes internos y comunicación relacionada con la operación del spa.
        </p>
      </LegalSection>

      <LegalSection title="2. Uso permitido">
        <p>El sistema debe utilizarse de manera responsable y únicamente para fines relacionados con ALMA Spa:</p>
        <LegalList
          items={[
            "Agendar y administrar reservas reales.",
            "Registrar información de clientes autorizada por la persona o por la operación del spa.",
            "Consultar historial de atención solo cuando sea necesario para prestar el servicio.",
            "Enviar comunicaciones relacionadas con reservas, confirmaciones, recordatorios o atención al cliente.",
            "Administrar usuarios, permisos y reportes según el rol asignado.",
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Responsabilidad sobre la información">
        <p>
          Las personas usuarias del sistema deben registrar información correcta, actualizada y necesaria. No se debe
          ingresar información falsa, ofensiva, innecesaria o ajena a la atención del spa.
        </p>
      </LegalSection>

      <LegalSection title="4. Reservas y disponibilidad">
        <p>
          Las reservas dependen de disponibilidad de horario, cabina, terapeuta y reglas internas del spa. El sistema
          puede asignar automáticamente la cabina más adecuada según el servicio elegido y la disponibilidad del día.
        </p>
      </LegalSection>

      <LegalSection title="5. Comunicaciones por WhatsApp">
        <p>
          ALMA Spa puede utilizar WhatsApp para confirmar reservas, enviar recordatorios, responder consultas y
          mantener comunicación operativa con clientes. Las comunicaciones deben ser respetuosas, claras y relacionadas
          con los servicios del spa.
        </p>
      </LegalSection>

      <LegalSection title="6. Cuentas y permisos">
        <p>
          Cada cuenta debe usarse únicamente por la persona autorizada. Los permisos se asignan según el rol y las
          responsabilidades dentro del spa. Algunas acciones pueden estar restringidas por horario o por permisos
          específicos.
        </p>
      </LegalSection>

      <LegalSection title="7. Seguridad">
        <p>
          Las personas usuarias deben proteger sus credenciales y cerrar sesión cuando usen equipos compartidos. ALMA
          Spa puede bloquear, desactivar o limitar cuentas si detecta uso indebido, riesgo de seguridad o salida de
          funciones laborales.
        </p>
      </LegalSection>

      <LegalSection title="8. Cambios del servicio">
        <p>
          El sistema puede mejorar, corregirse o cambiar sus funciones con el tiempo para adaptarse a la operación de
          ALMA Spa, mantener seguridad o cumplir requisitos de plataformas externas como Meta/WhatsApp.
        </p>
      </LegalSection>

      <LegalSection title="9. Contacto">
        <ContactLine />
      </LegalSection>
    </LegalPage>
  );
}

