import { setIcon } from 'obsidian'

export function iconButton(container: HTMLElement, icon: string, label: string,
  action: (event: MouseEvent) => void): HTMLButtonElement {
  const button = container.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': label, title: label } })
  setIcon(button, icon)
  button.addEventListener('click', action)
  return button
}