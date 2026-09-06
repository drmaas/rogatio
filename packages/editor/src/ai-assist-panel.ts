import type { AIProposal, EditorProjectSnapshot } from "./types.js";

interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string;
  proposal?: AIProposal;
  isStreaming?: boolean;
}

export function createAIAssistPanel(
  _container: HTMLElement,
  _editor: {
    getDraft: () => EditorProjectSnapshot;
    navigateToGroup: (groupId: string | null | undefined) => void;
  },
  onApply: (proposal: AIProposal) => void,
  onClose: () => void,
): {
  show: () => void;
  hide: () => void;
  isVisible: () => boolean;
  addMessage: (message: AIMessage) => void;
  clearMessages: () => void;
  startStreaming: (role: "assistant") => void;
  updateStreamingContent: (content: string) => void;
  finishStreaming: (proposal?: AIProposal) => void;
} {
  let visible = false;
  let streamingContent = "";
  let streamingMessageIndex = -1;
  const messages: AIMessage[] = [];

  const panel = document.createElement("div");
  panel.className = "ai-assist-panel";
  panel.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 400px;
    max-width: 100vw;
    background: #1e1e24;
    border-left: 1px solid #333;
    display: flex;
    flex-direction: column;
    z-index: 1000;
    transform: translateX(100%);
    transition: transform 0.2s ease;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    color: #e0e0e0;
  `;

  const header = document.createElement("div");
  header.style.cssText = `
    padding: 12px 16px;
    border-bottom: 1px solid #333;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #15151a;
  `;
  header.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
        <path d="M12 6v6l4 2"/>
      </svg>
      <span style="font-weight: 600;">AI Assist</span>
    </div>
    <button class="ai-close-btn" style="
      background: none;
      border: none;
      color: #888;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
    ">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;

  const messagesContainer = document.createElement("div");
  messagesContainer.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  `;

  const inputContainer = document.createElement("div");
  inputContainer.style.cssText = `
    padding: 12px 16px;
    border-top: 1px solid #333;
    background: #15151a;
  `;

  const inputWrapper = document.createElement("div");
  inputWrapper.style.cssText = `
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  `;

  const textarea = document.createElement("textarea");
  textarea.placeholder = "Ask AI to generate rules, fix issues, or explain...";
  textarea.style.cssText = `
    flex: 1;
    background: #2a2a34;
    border: 1px solid #3a3a48;
    border-radius: 8px;
    padding: 10px 12px;
    color: #e0e0e0;
    font-family: inherit;
    font-size: 13px;
    resize: none;
    min-height: 60px;
    max-height: 150px;
    outline: none;
  `;

  const sendButton = document.createElement("button");
  sendButton.textContent = "Send";
  sendButton.style.cssText = `
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 10px 20px;
    font-weight: 600;
    cursor: pointer;
    align-self: flex-end;
    transition: background 0.2s;
  `;

  const statusText = document.createElement("div");
  statusText.style.cssText = `
    font-size: 11px;
    color: #666;
    text-align: center;
  `;

  inputWrapper.appendChild(textarea);
  inputWrapper.appendChild(sendButton);
  inputContainer.appendChild(inputWrapper);
  inputContainer.appendChild(statusText);

  panel.appendChild(header);
  panel.appendChild(messagesContainer);
  panel.appendChild(inputContainer);

  const closeBtn = header.querySelector(".ai-close-btn") as HTMLButtonElement;

  function show(): void {
    if (!visible) {
      visible = true;
      document.body.appendChild(panel);
      requestAnimationFrame(() => {
        panel.style.transform = "translateX(0)";
      });
      textarea.focus();
    }
  }

  function hide(): void {
    if (visible) {
      visible = false;
      panel.style.transform = "translateX(100%)";
      setTimeout(() => {
        if (!visible && panel.parentNode) {
          panel.parentNode.removeChild(panel);
        }
      }, 200);
      onClose();
    }
  }

  function isVisible(): boolean {
    return visible;
  }

  function addMessage(message: AIMessage): void {
    const messageEl = document.createElement("div");
    messageEl.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 85%;
      ${message.role === "user" ? "align-self: flex-end;" : "align-self: flex-start;"}
    `;

    const bubble = document.createElement("div");
    bubble.style.cssText = `
      padding: 10px 14px;
      border-radius: 16px;
      ${
        message.role === "user"
          ? "background: #3b82f6; color: white; border-bottom-right-radius: 4px;"
          : "background: #2a2a34; color: #e0e0e0; border-bottom-left-radius: 4px;"
      }
      white-space: pre-wrap;
      word-wrap: break-word;
    `;
    bubble.textContent = message.content;

    messageEl.appendChild(bubble);

    if (message.proposal) {
      const proposalEl = createProposalElement(message.proposal);
      messageEl.appendChild(proposalEl);
    }

    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function createProposalElement(proposal: AIProposal): HTMLElement {
    const container = document.createElement("div");
    container.style.cssText = `
      margin-top: 8px;
      padding: 12px;
      background: #1a1a24;
      border: 1px solid #333;
      border-radius: 8px;
    `;

    const explanation = document.createElement("div");
    explanation.style.cssText = `
      font-size: 12px;
      color: #aaa;
      margin-bottom: 12px;
      line-height: 1.5;
    `;
    explanation.textContent = proposal.explanation;
    container.appendChild(explanation);

    const rulesList = document.createElement("div");
    rulesList.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    for (const rule of proposal.rules) {
      const ruleEl = document.createElement("div");
      ruleEl.style.cssText = `
        padding: 10px;
        background: #2a2a34;
        border-radius: 6px;
        border: 1px solid #3a3a48;
      `;

      const ruleHeader = document.createElement("div");
      ruleHeader.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      `;

      const kindBadge = document.createElement("span");
      kindBadge.textContent = rule.kind;
      kindBadge.style.cssText = `
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        padding: 2px 8px;
        border-radius: 4px;
        background: #3b82f6;
        color: white;
      `;

      const ruleName = document.createElement("span");
      ruleName.textContent = rule.name;
      ruleName.style.cssText = `
        font-weight: 500;
        flex: 1;
      `;

      ruleHeader.appendChild(kindBadge);
      ruleHeader.appendChild(ruleName);

      const ruleDetails = document.createElement("div");
      ruleDetails.style.cssText = `
        font-size: 11px;
        color: #888;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 4px 12px;
      `;

      const addDetail = (label: string, value: string) => {
        const detail = document.createElement("div");
        detail.innerHTML = `<span style="color:#666;">${label}:</span> ${value}`;
        ruleDetails.appendChild(detail);
      };

      addDetail("Regex", rule.urlRegex);
      if (rule.origins?.length) addDetail("Origins", rule.origins.join(", "));
      if (rule.resourceTypes?.length)
        addDetail("Types", rule.resourceTypes.join(", "));
      if (rule.priority !== undefined)
        addDetail("Priority", rule.priority.toString());
      if (rule.method) addDetail("Method", rule.method);

      const actionBtn = document.createElement("button");
      actionBtn.textContent = "Apply Rule";
      actionBtn.style.cssText = `
        margin-top: 10px;
        width: 100%;
        background: #22c55e;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
      `;
      actionBtn.addEventListener("click", () => {
        onApply(proposal);
        // Don't close - user may want to apply more
      });

      ruleEl.appendChild(ruleHeader);
      ruleEl.appendChild(ruleDetails);
      ruleEl.appendChild(actionBtn);
      rulesList.appendChild(ruleEl);
    }

    container.appendChild(rulesList);
    return container;
  }

  function clearMessages(): void {
    messages.length = 0;
    streamingContent = "";
    streamingMessageIndex = -1;
    messagesContainer.innerHTML = "";
  }

  function updateStreamingContent(content: string): void {
    if (streamingMessageIndex >= 0 && streamingMessageIndex < messages.length) {
      const message = messages[streamingMessageIndex];
      message.content = streamingContent + content;

      // Re-render just the last message
      const bubbles = messagesContainer.querySelectorAll(
        "div > div:first-child",
      );
      if (bubbles[streamingMessageIndex]) {
        (bubbles[streamingMessageIndex] as HTMLElement).textContent =
          message.content;
      }
    }
  }

  function startStreaming(role: "assistant"): void {
    streamingContent = "";
    const message: AIMessage = { role, content: "", isStreaming: true };
    messages.push(message);
    streamingMessageIndex = messages.length - 1;
    addMessage(message);
  }

  function finishStreaming(proposal?: AIProposal): void {
    if (streamingMessageIndex >= 0 && streamingMessageIndex < messages.length) {
      const message = messages[streamingMessageIndex];
      message.isStreaming = false;
      if (proposal) message.proposal = proposal;

      // Re-render the message with proposal if present
      const messageEls = messagesContainer.children;
      if (messageEls[streamingMessageIndex]) {
        const existingProposal = messageEls[
          streamingMessageIndex
        ].querySelector("div > div:last-child");
        if (proposal) {
          if (existingProposal) existingProposal.remove();
          const proposalEl = createProposalElement(proposal);
          (messageEls[streamingMessageIndex] as HTMLElement).appendChild(
            proposalEl,
          );
        }
      }
    }
    streamingContent = "";
    streamingMessageIndex = -1;
  }

  function handleSend(): void {
    const prompt = textarea.value.trim();
    if (!prompt) return;

    // This will be connected to the actual AI handler via the editor
    // The actual streaming is handled by the editor's aiAssist handler
    // This UI just displays the streamed content
    textarea.value = "";
    textarea.style.height = "auto";
  }

  closeBtn.addEventListener("click", hide);
  sendButton.addEventListener("click", handleSend);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  return {
    show,
    hide,
    isVisible,
    addMessage,
    clearMessages,
    // Expose streaming methods for the aiAssist handler to use
    startStreaming,
    updateStreamingContent,
    finishStreaming,
  };
}
