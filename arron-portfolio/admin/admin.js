import {
  DEFAULT_CONTENT,
  deleteCarouselImage,
  deleteStoredFile,
  isFirebaseConfigured,
  loadCarouselImages,
  loadSiteContent,
  saveSiteContent,
  uploadCarouselImage,
  uploadProfileImage,
  uploadToolIcon,
} from "../firebase.js";

let content = copyContent(DEFAULT_CONTENT);
let carouselImages = [];

const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", initAdmin);

async function initAdmin() {
  $("#configAlert").classList.toggle("is-visible", !isFirebaseConfigured);
  bindEvents();
  await loadAdminData();
}

function bindEvents() {
  $("#adminForm").addEventListener("submit", handleSave);
  $("#resetButton").addEventListener("click", loadAdminData);
  $("#addTimelineButton").addEventListener("click", () => {
    content.timeline.push({ year: "", title: "", description: "" });
    renderTimelineEditor();
  });
  $("#addSkillButton").addEventListener("click", () => {
    collectSkillData();
    content.about.skills.push("");
    renderSkillsEditor();
  });
  $("#addToolButton").addEventListener("click", () => {
    collectToolData();
    content.tools.push({ name: "", iconUrl: "", path: "", link: "" });
    renderToolsEditor();
  });
  $("#uploadProfileButton").addEventListener("click", handleProfileUpload);
  $("#uploadCarouselButton").addEventListener("click", handleCarouselUpload);
}

async function loadAdminData() {
  setStatus("Loading content...");

  try {
    content = await loadSiteContent();
    carouselImages = await loadCarouselImages();
    fillForm();
    setStatus(isFirebaseConfigured ? "Loaded from Firebase." : "Loaded fallback content.");
  } catch (error) {
    console.error(error);
    content = copyContent(DEFAULT_CONTENT);
    fillForm();
    setStatus("Could not load Firebase data. Showing fallback content.");
  }
}

function fillForm() {
  content.carousel = content.carousel || { heading: "Work Highlights" };
  content.journey = content.journey || { heading: "Journey" };
  content.about.skills = Array.isArray(content.about.skills) ? content.about.skills : [];
  content.tools = Array.isArray(content.tools) ? content.tools : [];

  $("#heroBrand").value = content.hero.brand || "";
  $("#heroEmail").value = content.hero.email || "";
  $("#heroFirstName").value = content.hero.firstName || "";
  $("#heroLastName").value = content.hero.lastName || "";
  $("#heroRole").value = content.hero.role || "";
  $("#heroAvailability").value = content.hero.availability || "";
  $("#profileCaption").value = content.hero.profileCaption || "";
  $("#heroSubtitle").value = content.hero.subtitle || "";

  $("#featuredHeading").value = content.featured.heading || "";
  $("#featuredSubtitle").value = content.featured.subtitle || "";
  $("#carouselHeading").value = content.carousel?.heading || "";
  $("#aboutHeading").value = content.about.heading || "";
  $("#aboutParagraphsInput").value = (content.about.paragraphs || []).join("\n\n");
  $("#journeyHeading").value = content.journey.heading || "";
  $("#contactHeading").value = content.contact.heading || "";
  $("#contactCopy").value = content.contact.copy || "";

  renderProfilePreview();
  renderStatsEditor();
  renderFeaturedEditor();
  renderSkillsEditor();
  renderTimelineEditor();
  renderCarouselAdminList();
  renderToolsEditor();
}

function renderProfilePreview() {
  const preview = $("#profilePreview");

  if (content.hero.profileImage) {
    preview.innerHTML = `<img src="${escapeAttribute(content.hero.profileImage)}" alt="Current profile image" />`;
  } else {
    preview.textContent = "AA";
  }
}

function renderStatsEditor() {
  const editor = $("#statsEditor");
  editor.innerHTML = "";

  content.stats.forEach((stat, index) => {
    const row = document.createElement("div");
    row.className = "editor-row stat-editor-row";
    row.dataset.index = index;
    row.innerHTML = `
      <div class="editor-row-header">
        <strong>${escapeHtml(stat.label || `Stat ${index + 1}`)}</strong>
      </div>
      <label class="field">
        <span>Label</span>
        <input data-stat-field="label" type="text" value="${escapeAttribute(stat.label || "")}" />
      </label>
      <label class="field">
        <span>Number</span>
        <input data-stat-field="value" type="number" min="0" value="${Number(stat.value) || 0}" />
      </label>
      <label class="field">
        <span>Suffix</span>
        <input data-stat-field="suffix" type="text" value="${escapeAttribute(stat.suffix || "+")}" />
      </label>
      <label class="field">
        <span>Google Drive / External Link</span>
        <input data-stat-field="link" type="url" value="${escapeAttribute(stat.link || "")}" />
      </label>
    `;
    editor.appendChild(row);
  });
}

function renderFeaturedEditor() {
  const editor = $("#featuredEditor");
  editor.innerHTML = "";

  content.featured.cards.forEach((card, index) => {
    const row = document.createElement("div");
    row.className = "editor-row featured-editor-row";
    row.dataset.index = index;
    row.innerHTML = `
      <div class="editor-row-header">
        <strong>${escapeHtml(card.title || `Card ${index + 1}`)}</strong>
      </div>
      <label class="field">
        <span>Title</span>
        <input data-featured-field="title" type="text" value="${escapeAttribute(card.title || "")}" />
      </label>
      <label class="field">
        <span>Theme</span>
        <select data-featured-field="theme">
          <option value="violet" ${card.theme === "violet" ? "selected" : ""}>Violet</option>
          <option value="rose" ${card.theme === "rose" ? "selected" : ""}>Rose</option>
          <option value="gold" ${card.theme === "gold" ? "selected" : ""}>Gold</option>
        </select>
      </label>
      <label class="field">
        <span>Google Drive / External Link</span>
        <input data-featured-field="url" type="url" value="${escapeAttribute(card.url || "")}" />
      </label>
      <label class="field">
        <span>Icon</span>
        <select data-featured-field="icon">
          <option value="palette" ${card.icon === "palette" ? "selected" : ""}>Palette</option>
          <option value="clapper" ${card.icon === "clapper" ? "selected" : ""}>Clapper</option>
          <option value="film" ${card.icon === "film" ? "selected" : ""}>Film</option>
        </select>
      </label>
      <label class="field field-full">
        <span>Description</span>
        <textarea data-featured-field="description">${escapeHtml(card.description || "")}</textarea>
      </label>
    `;
    editor.appendChild(row);
  });
}

function renderTimelineEditor() {
  const editor = $("#timelineEditor");
  editor.innerHTML = "";

  content.timeline.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "editor-row timeline-editor-row";
    row.dataset.index = index;
    row.innerHTML = `
      <div class="editor-row-header">
        <strong>Timeline Item ${index + 1}</strong>
        <button class="admin-button warning" type="button" data-remove-timeline="${index}">Remove</button>
      </div>
      <label class="field">
        <span>Year</span>
        <input data-timeline-field="year" type="text" value="${escapeAttribute(item.year || "")}" />
      </label>
      <label class="field">
        <span>Title</span>
        <input data-timeline-field="title" type="text" value="${escapeAttribute(item.title || "")}" />
      </label>
      <label class="field field-full">
        <span>Description</span>
        <textarea data-timeline-field="description">${escapeHtml(item.description || "")}</textarea>
      </label>
    `;
    editor.appendChild(row);
  });

  editor.querySelectorAll("[data-remove-timeline]").forEach((button) => {
    button.addEventListener("click", () => {
      content.timeline.splice(Number(button.dataset.removeTimeline), 1);
      renderTimelineEditor();
    });
  });
}

function renderSkillsEditor() {
  const editor = $("#skillsEditor");
  editor.innerHTML = "";

  if (!content.about.skills.length) {
    editor.innerHTML = "<p class=\"status-line\">No skills yet. Add one to show a new chip.</p>";
    return;
  }

  content.about.skills.forEach((skill, index) => {
    const row = document.createElement("div");
    row.className = "skill-editor-row";
    row.dataset.index = index;
    row.innerHTML = `
      <input data-skill-field type="text" value="${escapeAttribute(skill || "")}" placeholder="Skill name" />
      <button class="admin-button warning" type="button" data-remove-skill="${index}">Remove</button>
    `;
    editor.appendChild(row);
  });

  editor.querySelectorAll("[data-remove-skill]").forEach((button) => {
    button.addEventListener("click", () => {
      collectSkillData();
      content.about.skills.splice(Number(button.dataset.removeSkill), 1);
      renderSkillsEditor();
    });
  });
}

function renderCarouselAdminList() {
  const list = $("#carouselAdminList");
  list.innerHTML = "";

  if (!carouselImages.length) {
    list.innerHTML = "<p class=\"status-line\">No Firebase carousel images uploaded yet.</p>";
    return;
  }

  carouselImages.forEach((image) => {
    const item = document.createElement("article");
    item.className = "carousel-admin-item";
    item.innerHTML = `
      <img src="${escapeAttribute(image.url)}" alt="${escapeAttribute(image.alt || image.name || "Carousel image")}" loading="lazy" />
      <div>
        <p>${escapeHtml(image.name || image.alt || "Carousel image")}</p>
        <button class="admin-button warning" type="button">Remove</button>
      </div>
    `;

    item.querySelector("button").addEventListener("click", async () => {
      if (!window.confirm("Remove this carousel image from Firebase?")) return;
      setStatus("Removing image...");
      try {
        await deleteCarouselImage(image);
        carouselImages = carouselImages.filter((entry) => entry.id !== image.id);
        renderCarouselAdminList();
        setStatus("Carousel image removed.");
      } catch (error) {
        console.error(error);
        setStatus(error.message);
      }
    });

    list.appendChild(item);
  });
}

function renderToolsEditor() {
  const editor = $("#toolsEditor");
  editor.innerHTML = "";

  if (!content.tools.length) {
    editor.innerHTML = "<p class=\"status-line\">No app icon slots yet. Add one to upload a logo.</p>";
    return;
  }

  content.tools.forEach((tool, index) => {
    const row = document.createElement("div");
    row.className = "editor-row tool-editor-row";
    row.dataset.index = index;
    row.innerHTML = `
      <div class="editor-row-header">
        <strong>${escapeHtml(tool.name || `App Icon ${index + 1}`)}</strong>
        <button class="admin-button warning" type="button" data-remove-tool="${index}">Remove</button>
      </div>
      <div class="tool-admin-preview">
        ${tool.iconUrl ? `<img src="${escapeAttribute(tool.iconUrl)}" alt="${escapeAttribute(tool.name || "App icon")}" />` : "<span>No icon</span>"}
      </div>
      <div class="form-grid">
        <label class="field">
          <span>App Name</span>
          <input data-tool-field="name" type="text" value="${escapeAttribute(tool.name || "")}" />
        </label>
        <label class="field">
          <span>Logo Link</span>
          <input data-tool-field="link" type="url" value="${escapeAttribute(tool.link || "")}" />
        </label>
        <label class="field">
          <span>Upload / Replace Icon</span>
          <input data-tool-file type="file" accept="image/*" />
        </label>
        <button class="admin-button secondary" type="button" data-upload-tool="${index}">Upload Icon</button>
      </div>
    `;

    editor.appendChild(row);
  });

  editor.querySelectorAll("[data-upload-tool]").forEach((button) => {
    button.addEventListener("click", () => handleToolIconUpload(Number(button.dataset.uploadTool)));
  });

  editor.querySelectorAll("[data-remove-tool]").forEach((button) => {
    button.addEventListener("click", () => handleToolRemove(Number(button.dataset.removeTool)));
  });
}

async function handleSave(event) {
  event.preventDefault();
  collectFormData();

  setStatus("Saving changes...");

  try {
    await saveSiteContent(content);
    setStatus("Saved. Your live site will reflect these changes.");
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
}

async function handleToolIconUpload(index) {
  collectToolData();

  const row = document.querySelector(`.tool-editor-row[data-index="${index}"]`);
  const file = row?.querySelector("[data-tool-file]")?.files[0];

  if (!file) {
    setStatus("Choose an app icon file first.");
    return;
  }

  setStatus("Uploading app icon...");

  try {
    const uploaded = await uploadToolIcon(file);
    content.tools[index] = {
      ...content.tools[index],
      name: content.tools[index].name || uploaded.name,
      iconUrl: uploaded.iconUrl,
      path: uploaded.path,
    };
    renderToolsEditor();
    setStatus("App icon uploaded. Press Save Changes to publish it.");
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
}

async function handleToolRemove(index) {
  collectToolData();

  const tool = content.tools[index];
  if (!window.confirm("Remove this app icon slot? If it has an uploaded file, it will also be removed from Firebase Storage.")) {
    return;
  }

  setStatus("Removing app icon...");

  try {
    if (tool?.path) {
      await deleteStoredFile(tool.path);
    }

    content.tools.splice(index, 1);
    renderToolsEditor();
    setStatus("App icon removed. Press Save Changes to publish the updated list.");
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
}

async function handleProfileUpload() {
  const file = $("#profileUpload").files[0];
  if (!file) {
    setStatus("Choose a profile image first.");
    return;
  }

  setStatus("Uploading profile image...");

  try {
    const url = await uploadProfileImage(file);
    content.hero.profileImage = url;
    renderProfilePreview();
    setStatus("Profile image uploaded. Press Save Changes to publish it.");
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
}

async function handleCarouselUpload() {
  const files = Array.from($("#carouselUpload").files || []);
  if (!files.length) {
    setStatus("Choose at least one carousel image first.");
    return;
  }

  setStatus(`Uploading ${files.length} image${files.length > 1 ? "s" : ""}...`);

  try {
    for (const file of files) {
      const uploaded = await uploadCarouselImage(file);
      carouselImages.unshift(uploaded);
    }
    $("#carouselUpload").value = "";
    renderCarouselAdminList();
    setStatus("Carousel upload complete.");
  } catch (error) {
    console.error(error);
    setStatus(error.message);
  }
}

function collectFormData() {
  content.hero = {
    ...content.hero,
    brand: $("#heroBrand").value.trim(),
    email: $("#heroEmail").value.trim(),
    firstName: $("#heroFirstName").value.trim(),
    lastName: $("#heroLastName").value.trim(),
    fullName: `${$("#heroFirstName").value.trim()} ${$("#heroLastName").value.trim()}`.trim(),
    role: $("#heroRole").value.trim(),
    availability: $("#heroAvailability").value.trim(),
    profileCaption: $("#profileCaption").value.trim(),
    subtitle: $("#heroSubtitle").value.trim(),
  };

  content.stats = Array.from(document.querySelectorAll(".stat-editor-row")).map((row, index) => ({
    ...content.stats[index],
    label: row.querySelector('[data-stat-field="label"]').value.trim(),
    value: Number(row.querySelector('[data-stat-field="value"]').value) || 0,
    suffix: row.querySelector('[data-stat-field="suffix"]').value.trim(),
    link: row.querySelector('[data-stat-field="link"]').value.trim(),
  }));

  content.featured = {
    ...content.featured,
    heading: $("#featuredHeading").value.trim(),
    subtitle: $("#featuredSubtitle").value.trim(),
    cards: Array.from(document.querySelectorAll(".featured-editor-row")).map((row, index) => ({
      ...content.featured.cards[index],
      title: row.querySelector('[data-featured-field="title"]').value.trim(),
      theme: row.querySelector('[data-featured-field="theme"]').value,
      url: row.querySelector('[data-featured-field="url"]').value.trim(),
      icon: row.querySelector('[data-featured-field="icon"]').value,
      description: row.querySelector('[data-featured-field="description"]').value.trim(),
    })),
  };

  content.carousel = {
    heading: $("#carouselHeading").value.trim(),
  };

  content.journey = {
    heading: $("#journeyHeading").value.trim(),
  };

  content.about = {
    heading: $("#aboutHeading").value.trim(),
    paragraphs: splitParagraphs($("#aboutParagraphsInput").value),
    skills: collectSkillData(),
  };

  content.timeline = Array.from(document.querySelectorAll(".timeline-editor-row")).map((row) => ({
    year: row.querySelector('[data-timeline-field="year"]').value.trim(),
    title: row.querySelector('[data-timeline-field="title"]').value.trim(),
    description: row.querySelector('[data-timeline-field="description"]').value.trim(),
  }));

  content.contact = {
    heading: $("#contactHeading").value.trim(),
    copy: $("#contactCopy").value.trim(),
  };

  collectToolData();
}

function collectToolData() {
  content.tools = Array.from(document.querySelectorAll(".tool-editor-row")).map((row, index) => ({
    ...content.tools[index],
    name: row.querySelector('[data-tool-field="name"]').value.trim(),
    link: row.querySelector('[data-tool-field="link"]').value.trim(),
  }));
}

function collectSkillData() {
  content.about.skills = Array.from(document.querySelectorAll("[data-skill-field]"))
    .map((input) => input.value.trim())
    .filter(Boolean);

  return content.about.skills;
}

function splitParagraphs(value) {
  return value
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function copyContent(value) {
  return JSON.parse(JSON.stringify(value));
}

function setStatus(message) {
  $("#saveStatus").textContent = message;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[character];
  });
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
