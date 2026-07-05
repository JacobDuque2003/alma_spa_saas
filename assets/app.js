const state = {
  activeView: "dashboard",
  selectedChannel: "Todos",
  selectedConversationId: "c1",
  conversations: [
    {
      id: "c1",
      name: "Maria Fernanda",
      channel: "WhatsApp",
      status: "Quiere agendar",
      temperature: "hot",
      service: "Limpieza facial profunda",
      lastMessage: "Tienen cita el sabado en la tarde?",
      phone: "+593 99 280 1822",
      source: "Instagram Ads",
      notes: "Piel sensible. Prefiere horarios despues de las 15:00.",
      messages: [
        { from: "client", text: "Hola, cuanto cuesta una limpieza facial profunda?" },
        { from: "agent", text: "Hola Maria, la limpieza facial profunda dura 75 minutos y tiene un valor de $45. Incluye diagnostico, limpieza, extraccion suave y mascarilla calmante." },
        { from: "client", text: "Tienen cita el sabado en la tarde?" }
      ]
    },
    {
      id: "c2",
      name: "Daniela Ruiz",
      channel: "TikTok",
      status: "Interesada",
      temperature: "warm",
      service: "Masaje relajante",
      lastMessage: "Vi el video del masaje, que incluye?",
      phone: "Pendiente",
      source: "TikTok organic",
      notes: "Pregunto por experiencia de pareja.",
      messages: [
        { from: "client", text: "Vi el video del masaje, que incluye?" },
        { from: "agent", text: "Incluye aromaterapia, masaje de espalda, cuello y piernas. Podemos adaptarlo si buscas relajacion o tension muscular." }
      ]
    },
    {
      id: "c3",
      name: "Andrea Molina",
      channel: "Instagram",
      status: "Atencion humana",
      temperature: "human",
      service: "Valoracion facial",
      lastMessage: "Estoy embarazada, puedo hacerme algun facial?",
      phone: "Pendiente",
      source: "Mensaje directo",
      notes: "Escalar antes de recomendar tratamientos.",
      messages: [
        { from: "client", text: "Estoy embarazada, puedo hacerme algun facial?" }
      ]
    },
    {
      id: "c4",
      name: "Paola Cardenas",
      channel: "WhatsApp",
      status: "Seguimiento",
      temperature: "warm",
      service: "Paquete bienestar",
      lastMessage: "Lo voy a pensar, gracias",
      phone: "+593 98 410 1120",
      source: "Referido",
      notes: "Enviar seguimiento suave manana.",
      messages: [
        { from: "client", text: "Me interesa un paquete mensual." },
        { from: "agent", text: "Tenemos un paquete de 4 sesiones para bienestar y relajacion. Te ayuda a mantener una rutina de cuidado sin decidir cada semana desde cero." },
        { from: "client", text: "Lo voy a pensar, gracias" }
      ]
    },
    {
      id: "c5",
      name: "Carolina Mejia",
      channel: "Facebook",
      status: "Interesada",
      temperature: "warm",
      service: "Ritual ALMA",
      lastMessage: "Hola, vi la publicacion del ritual, cuanto dura?",
      phone: "Pendiente",
      source: "Facebook Ads",
      notes: "Interes por ritual premium de fin de semana.",
      messages: [
        { from: "client", text: "Hola, vi la publicacion del ritual, cuanto dura?" },
        { from: "agent", text: "Hola Carolina, el Ritual ALMA dura 100 minutos e incluye masaje, aromaterapia y cuidado facial express. Es ideal si buscas una experiencia completa de pausa y bienestar." }
      ]
    }
  ],
  appointments: [
    { client: "Maria Fernanda", service: "Limpieza facial profunda", day: "Lunes", time: "10:00", status: "Confirmada" },
    { client: "Camila Torres", service: "Masaje relajante", day: "Lunes", time: "12:00", status: "Recordatorio enviado" },
    { client: "Paola Cardenas", service: "Paquete bienestar", day: "Martes", time: "15:00", status: "Pendiente" },
    { client: "Sofia Vera", service: "Drenaje linfatico", day: "Miercoles", time: "11:00", status: "Confirmada" }
  ],
  services: [
    { name: "Limpieza facial profunda", price: "$45", duration: "75 min", category: "Facial", copy: "Ideal para limpiar impurezas, hidratar y dejar la piel con sensacion fresca." },
    { name: "Masaje relajante", price: "$38", duration: "60 min", category: "Bienestar", copy: "Sesion corporal con aromaterapia para descanso, tension y pausa mental." },
    { name: "Drenaje linfatico", price: "$42", duration: "60 min", category: "Corporal", copy: "Tratamiento manual suave para sensacion de ligereza y bienestar." },
    { name: "Ritual ALMA", price: "$70", duration: "100 min", category: "Premium", copy: "Experiencia completa con masaje, aromaterapia y cuidado facial express." },
    { name: "Valoracion facial", price: "$15", duration: "25 min", category: "Diagnostico", copy: "Recomendacion personalizada antes de elegir tratamiento." },
    { name: "Paquete bienestar", price: "$140", duration: "4 sesiones", category: "Paquete", copy: "Plan mensual para clientes frecuentes con seguimiento y recordatorios." }
  ],
  campaigns: [
    { name: "Facial luminoso", channel: "Instagram + WhatsApp", leads: 26, bookings: 9 },
    { name: "Masaje despues del trabajo", channel: "TikTok", leads: 41, bookings: 11 },
    { name: "Clientes dormidos 30 dias", channel: "WhatsApp", leads: 18, bookings: 5 },
    { name: "Ritual de fin de semana", channel: "Facebook", leads: 22, bookings: 6 }
  ]
};

const titles = {
  dashboard: "Panel de control",
  inbox: "Bandeja omnicanal",
  calendar: "Agenda inteligente",
  clients: "Clientes",
  services: "Servicios",
  campaigns: "Campañas",
  bot: "Bot IA"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function channelClass(channel = "") {
  const value = channel.toLowerCase();
  if (value.includes("facebook")) return "channel-facebook";
  if (value.includes("instagram")) return "channel-instagram";
  if (value.includes("whatsapp")) return "channel-whatsapp";
  if (value.includes("tiktok")) return "channel-tiktok";
  return "channel-default";
}

function channelLabel(channel) {
  return `<span class="channel-badge ${channelClass(channel)}">${channel}</span>`;
}

function setView(view) {
  state.activeView = view;
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === view));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $("#viewTitle").textContent = titles[view];
}

function selectedConversation() {
  return state.conversations.find((conversation) => conversation.id === state.selectedConversationId);
}

function renderPipeline() {
  const stages = [
    { name: "Nuevo", items: state.conversations.filter((item) => item.status === "Interesada") },
    { name: "Quiere agendar", items: state.conversations.filter((item) => item.status === "Quiere agendar") },
    { name: "Seguimiento", items: state.conversations.filter((item) => item.status === "Seguimiento") },
    { name: "Humano", items: state.conversations.filter((item) => item.status === "Atencion humana") }
  ];

  $("#pipeline").innerHTML = stages.map((stage) => `
    <div class="pipeline-stage">
      <strong>${stage.name} · ${stage.items.length}</strong>
      ${stage.items.map((item) => `
        <div class="pipeline-pill">
          <span>${item.name}</span>
          ${channelLabel(item.channel)}
        </div>
      `).join("")}
    </div>
  `).join("");
}

function renderAppointments() {
  $("#appointmentList").innerHTML = state.appointments.slice(0, 4).map((item) => `
    <article class="appointment">
      <strong>${item.time} · ${item.client}</strong>
      <span>${item.service}</span>
      <span>${item.status}</span>
    </article>
  `).join("");
}

function renderHotLeads() {
  const leads = state.conversations.filter((item) => item.temperature === "hot" || item.temperature === "human");
  $("#hotLeads").innerHTML = leads.map((item) => `
    <article class="lead-row ${channelClass(item.channel)}">
      <strong>${item.name}</strong>
      <span>${item.service}</span>
      ${channelLabel(item.channel)}
      <span class="tag ${item.temperature === "human" ? "human" : "hot"}">${item.status}</span>
    </article>
  `).join("");
}

function filteredConversations() {
  const query = ($("#conversationSearch")?.value || "").trim().toLowerCase();
  return state.conversations.filter((item) => {
    const matchesChannel = state.selectedChannel === "Todos" || item.channel === state.selectedChannel;
    const matchesQuery = !query || `${item.name} ${item.service} ${item.lastMessage}`.toLowerCase().includes(query);
    return matchesChannel && matchesQuery;
  });
}

function renderConversations() {
  $("#conversationList").innerHTML = filteredConversations().map((item) => `
    <button class="conversation-card ${channelClass(item.channel)} ${item.id === state.selectedConversationId ? "active" : ""}" data-conversation-id="${item.id}" type="button">
      <strong>${item.name}</strong>
      ${channelLabel(item.channel)}
      <p>${item.lastMessage}</p>
    </button>
  `).join("");

  $$(".conversation-card").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedConversationId = button.dataset.conversationId;
      renderConversations();
      renderChat();
      renderClientPanel();
    });
  });
}

function suggestedReply(conversation) {
  if (!conversation) return "";
  if (conversation.temperature === "human") {
    return "Esta conversacion debe pasar a una asesora. Respuesta sugerida: Gracias por contarnos. Para cuidarte bien, una asesora de ALMA revisara tu caso antes de recomendarte un tratamiento.";
  }
  if (conversation.status === "Quiere agendar") {
    return "Respuesta sugerida: Claro, tenemos opciones el sabado a las 15:30 y 17:00. La limpieza facial profunda dura 75 minutos y cuesta $45. Cual horario te queda mejor?";
  }
  return "Respuesta sugerida: Gracias por escribirnos. Te puedo contar opciones segun lo que buscas y, si deseas, reviso disponibilidad para agendarte esta semana.";
}

function renderChat() {
  const conversation = selectedConversation();
  if (!conversation) return;
  $("#chatPanel").className = `chat-panel ${channelClass(conversation.channel)}`;
  $("#chatPanel").innerHTML = `
    <div class="chat-header">
      <strong>${conversation.name}</strong>
      <span>${conversation.channel} · ${conversation.status}</span>
    </div>
    <div class="message-list">
      ${conversation.messages.map((message) => `
        <div class="message ${message.from === "client" ? "client" : "agent"}">${message.text}</div>
      `).join("")}
    </div>
    <div class="suggestion-box">${suggestedReply(conversation)}</div>
    <div class="composer">
      <textarea id="replyText" aria-label="Respuesta" rows="1">${suggestedReply(conversation).replace("Respuesta sugerida: ", "")}</textarea>
      <button class="primary-action" id="sendReplyBtn" type="button">Enviar</button>
    </div>
  `;

  $("#sendReplyBtn").addEventListener("click", () => {
    const text = $("#replyText").value.trim();
    if (!text) return;
    conversation.messages.push({ from: "agent", text });
    conversation.lastMessage = text;
    renderChat();
    renderConversations();
  });
}

function renderClientPanel() {
  const conversation = selectedConversation();
  if (!conversation) {
    $("#clientPanel").innerHTML = "";
    return;
  }
  $("#clientPanel").className = `client-panel ${channelClass(conversation.channel)}`;
  $("#clientPanel").innerHTML = `
    <div class="client-header">
      <strong>${conversation.name}</strong>
      <span>${conversation.status}</span>
    </div>
    <div class="client-detail">
      <div class="detail-line"><span>Telefono</span><strong>${conversation.phone}</strong></div>
      <div class="detail-line"><span>Canal</span>${channelLabel(conversation.channel)}</div>
      <div class="detail-line"><span>Servicio de interes</span><strong>${conversation.service}</strong></div>
      <div class="detail-line"><span>Fuente</span><strong>${conversation.source}</strong></div>
      <div class="detail-line"><span>Notas</span><p>${conversation.notes}</p></div>
      <button class="primary-action" type="button" id="bookSelectedClient">Agendar cita</button>
    </div>
  `;

  $("#bookSelectedClient").addEventListener("click", () => openBookingModal(conversation.name, conversation.service));
}

function renderCalendar() {
  const days = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes"];
  const times = ["09:00", "10:00", "11:00", "12:00", "15:00", "16:00"];
  let html = `<div class="calendar-head"></div>${days.map((day) => `<div class="calendar-head">${day}</div>`).join("")}`;

  times.forEach((time) => {
    html += `<div class="calendar-cell time-cell">${time}</div>`;
    days.forEach((day) => {
      const booking = state.appointments.find((item) => item.day === day && item.time === time);
      html += `<div class="calendar-cell">${booking ? `<div class="booking-chip"><strong>${booking.client}</strong><span>${booking.service}</span></div>` : ""}</div>`;
    });
  });

  $("#calendarGrid").innerHTML = html;
}

function renderClients() {
  const query = ($("#clientSearch")?.value || "").trim().toLowerCase();
  const clients = state.conversations.filter((item) => !query || item.name.toLowerCase().includes(query));

  $("#clientGrid").innerHTML = clients.map((item) => `
    <article class="client-card ${channelClass(item.channel)}">
      <span class="tag ${item.temperature === "hot" ? "hot" : item.temperature === "human" ? "human" : "ok"}">${item.status}</span>
      <strong>${item.name}</strong>
      <p>${item.service}</p>
      <p>${item.source}</p>
      ${channelLabel(item.channel)}
    </article>
  `).join("");
}

function renderServices() {
  $("#servicesGrid").innerHTML = state.services.map((service) => `
    <article class="service-card">
      <span class="tag ok">${service.category}</span>
      <strong>${service.name}</strong>
      <p>${service.copy}</p>
      <div class="service-meta">
        <span class="tag">${service.price}</span>
        <span class="tag">${service.duration}</span>
      </div>
    </article>
  `).join("");

  $("#bookingService").innerHTML = state.services.map((service) => `<option>${service.name}</option>`).join("");
}

function renderCampaigns() {
  $("#campaignList").innerHTML = state.campaigns.map((item) => `
    <article class="campaign-row ${channelClass(item.channel)}">
      <strong>${item.name}</strong>
      ${channelLabel(item.channel)}
      <span>${item.leads} leads · ${item.bookings} citas</span>
    </article>
  `).join("");

  $("#automationList").innerHTML = [
    "Recordatorio 24 horas antes de la cita",
    "Mensaje post-servicio 2 horas despues",
    "Reactivacion si no responde en 48 horas",
    "Invitacion a volver despues de 30 dias"
  ].map((item) => `<article class="automation-row"><strong>${item}</strong><span>Activo</span></article>`).join("");
}

function openBookingModal(client = "", service = "") {
  $("#bookingClient").value = client;
  $("#bookingService").value = service || state.services[0].name;
  $("#bookingDate").valueAsDate = new Date();
  $("#bookingTime").value = "15:00";
  $("#bookingModal").showModal();
}

function saveBooking() {
  const client = $("#bookingClient").value.trim() || "Cliente nuevo";
  const service = $("#bookingService").value;
  const time = $("#bookingTime").value || "15:00";
  state.appointments.push({ client, service, day: "Jueves", time, status: "Confirmada" });
  $("#bookingModal").close();
  renderAppointments();
  renderCalendar();
  setView("calendar");
}

function generateBotReply() {
  const prompt = $("#botPrompt").value.toLowerCase();
  let reply = "Hola, gracias por escribir a ALMA Spa. Te puedo ayudar con informacion de servicios, disponibilidad y agendamiento.";

  if (prompt.includes("limpieza") || prompt.includes("facial")) {
    reply = "Hola, claro. La limpieza facial profunda dura 75 minutos y cuesta $45. Si deseas venir el sabado, puedo ofrecerte 15:30 o 17:00. Si tienes piel sensible, embarazo o algun tratamiento medico, te paso primero con una asesora para cuidarte mejor.";
  } else if (prompt.includes("masaje")) {
    reply = "Hola, el masaje relajante dura 60 minutos y cuesta $38. Incluye aromaterapia y trabajo suave en zonas de tension. Tengo disponibilidad hoy a las 16:00 o manana a las 10:00.";
  } else if (prompt.includes("precio")) {
    reply = "Con gusto. Para darte el precio correcto, dime si buscas facial, masaje, drenaje o un ritual completo. Tambien puedo revisar horarios disponibles para esta semana.";
  }

  $("#botPreview").textContent = reply;
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$("[data-view-shortcut]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewShortcut)));
  $$(".channel-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedChannel = button.dataset.channel;
      $$(".channel-tab").forEach((item) => item.classList.toggle("active", item === button));
      renderConversations();
    });
  });

  $("#conversationSearch").addEventListener("input", renderConversations);
  $("#clientSearch").addEventListener("input", renderClients);
  $("#newBookingBtn").addEventListener("click", () => openBookingModal());
  $("#quickBookingBtn").addEventListener("click", () => openBookingModal());
  $("#saveBookingBtn").addEventListener("click", saveBooking);
  $("#generateReplyBtn").addEventListener("click", generateBotReply);
  $("#saveBotBtn").addEventListener("click", () => {
    $("#saveBotBtn").textContent = "Guardado";
    setTimeout(() => {
      $("#saveBotBtn").textContent = "Guardar cambios";
    }, 1300);
  });
}

function boot() {
  renderPipeline();
  renderAppointments();
  renderHotLeads();
  renderConversations();
  renderChat();
  renderClientPanel();
  renderCalendar();
  renderClients();
  renderServices();
  renderCampaigns();
  generateBotReply();
  bindEvents();
}

boot();
