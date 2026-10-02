/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

// Mirror the project convention: t() echoes the key so labels/tooltips are assertable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => (k === 'login.brand' ? 'Build Your Own' : k),
    i18n: { language: 'en' },
  }),
}));

// Observe real router navigation so link behavior is exercised without a custom link mock.
const navigate = vi.fn();
let currentPathname = '/guid';
const platformMocks = vi.hoisted(() => ({
  isElectronDesktopMock: vi.fn(() => false),
}));
const shortcutMocks = vi.hoisted(() => ({
  params: undefined as undefined | { toggleSider: () => void },
}));
const featureMocks = vi.hoisted(() => ({
  teamModeEnabled: false,
}));

// Hidden devtools easter-egg target (icon) — assert it is independent of navigation.
const openDevTools = vi.fn(() => Promise.resolve());
vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      openDevTools: { invoke: () => openDevTools() },
      logStream: { on: () => () => {} },
    },
    task: { stopAll: { invoke: () => Promise.resolve({ success: false }) } },
  },
}));

// Trim Layout's collaborators to keep this a focused brand-behaviour test.
vi.mock('@/common/config/constants', () => ({
  get TEAM_MODE_ENABLED() {
    return featureMocks.teamModeEnabled;
  },
}));
vi.mock('@/renderer/components/layout/PwaPullToRefresh', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Titlebar', () => ({ default: () => null }));
vi.mock('@/renderer/components/settings/UpdateModal', () => ({ default: () => null }));
vi.mock('@renderer/hooks/system/useDeepLink', () => ({ useDeepLink: () => {} }));
vi.mock('@renderer/hooks/system/notification/useNotificationClick', () => ({ useNotificationClick: () => {} }));
vi.mock('@renderer/hooks/system/notification/useBrowserNotification', () => ({ useBrowserNotification: () => {} }));
vi.mock('@renderer/hooks/file/useDirectorySelection', () => ({
  useDirectorySelection: () => ({ contextHolder: null }),
}));
vi.mock('@renderer/utils/ui/siderTooltip', () => ({ cleanupSiderTooltips: () => {} }));
vi.mock('@renderer/hooks/ui/useConversationShortcuts', () => ({
  useConversationShortcuts: (params: { toggleSider: () => void }) => {
    shortcutMocks.params = params;
  },
}));
vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: platformMocks.isElectronDesktopMock }));
vi.mock('@renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ closePreview: () => {} }),
}));

import Layout from '@renderer/components/layout/Layout';

const NavigationObserver = () => {
  const location = useLocation();
  const previous = React.useRef(location.key);
  React.useEffect(() => {
    if (location.key !== previous.current) navigate(location.pathname);
    previous.current = location.key;
  }, [location]);
  return null;
};
const renderLayout = () =>
  render(
    <MemoryRouter initialEntries={[currentPathname]}>
      <NavigationObserver />
      <Layout sider={<div>sider</div>} />
    </MemoryRouter>
  );

const BRAND = 'Build Your Own';

describe('Layout sider brand Home button', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    navigate.mockClear();
    openDevTools.mockClear();
    platformMocks.isElectronDesktopMock.mockReturnValue(false);
    shortcutMocks.params = undefined;
    featureMocks.teamModeEnabled = false;
    sessionStorage.clear();
    currentPathname = '/guid';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('navigates home from settings even when a last chat is recorded', () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/conversation/abc');
    renderLayout();

    fireEvent.click(screen.getByRole('link', { name: BRAND }));
    expect(navigate).toHaveBeenCalledWith('/guid');
  });

  it('falls back to /guid in a settings route when no path is recorded', () => {
    currentPathname = '/settings/system';
    renderLayout();

    fireEvent.click(screen.getByRole('link', { name: BRAND }));
    expect(navigate).toHaveBeenCalledWith('/guid');
  });

  it('falls back to /guid when the recorded path is itself a settings path', () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/settings/system');
    renderLayout();

    fireEvent.click(screen.getByRole('link', { name: BRAND }));
    expect(navigate).toHaveBeenCalledWith('/guid');
  });

  it('activates the home link with Enter and retains native keyboard focus', async () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/conversation/abc');
    renderLayout();

    const brand = screen.getByRole('link', { name: BRAND });
    brand.focus();
    expect(brand).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/guid');
  });

  it('ignores non-activation keys in a settings route', () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/conversation/abc');
    renderLayout();

    const brand = screen.getByRole('link', { name: BRAND });
    fireEvent.keyDown(brand, { key: 'Tab' });
    fireEvent.keyDown(brand, { key: 'a' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders the logo and wordmark in one native home link on the home page', () => {
    currentPathname = '/guid';
    renderLayout();

    const link = screen.getByRole('link', { name: BRAND });
    expect(link).toHaveAttribute('href', '/guid');
    expect(link).toContainElement(screen.getByRole('img', { name: BRAND }));
    expect(link).toContainElement(screen.getByText(BRAND));
  });

  it('navigates home from a conversation without clearing its persisted draft', () => {
    currentPathname = '/conversation/xyz';
    sessionStorage.setItem('conversation-draft-fixture', 'unfinished prompt');
    renderLayout();

    fireEvent.click(screen.getByText('Build Your Own'));
    expect(navigate).toHaveBeenCalledWith('/guid');
    expect(sessionStorage.getItem('conversation-draft-fixture')).toBe('unfinished prompt');
  });

  it('provides common shortcuts with a functional sider toggle', () => {
    currentPathname = '/conversation/xyz';
    const { container } = renderLayout();
    const sider = container.querySelector('.layout-sider');

    expect(shortcutMocks.params?.toggleSider).toEqual(expect.any(Function));
    expect(sider).not.toHaveClass('collapsed');

    act(() => shortcutMocks.params?.toggleSider());
    expect(sider).toHaveClass('collapsed');

    act(() => shortcutMocks.params?.toggleSider());
    expect(sider).not.toHaveClass('collapsed');
  });

  it('keeps the common shortcut owner mounted on team routes', () => {
    currentPathname = '/team/team-1';
    featureMocks.teamModeEnabled = true;

    renderLayout();

    expect(shortcutMocks.params?.toggleSider).toEqual(expect.any(Function));
  });

  it('keeps the desktop logo debug shortcut while also navigating home', () => {
    platformMocks.isElectronDesktopMock.mockReturnValue(true);
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/conversation/abc');
    renderLayout();

    // Desktop retains its icon shortcut inside the same accessible home link.
    const icon = screen.getByRole('img', { name: 'Build Your Own' });
    expect(icon).toBeTruthy();
    for (let i = 0; i < 4; i++) fireEvent.click(icon);
    expect(openDevTools).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/guid');
  });

  it('clicking the browser logo navigates home without requesting desktop devtools', () => {
    currentPathname = '/conversation/xyz';
    renderLayout();
    const logo = screen.getByRole('img', { name: BRAND });
    for (let i = 0; i < 4; i++) fireEvent.click(logo);
    expect(navigate).toHaveBeenCalledWith('/guid');
    expect(openDevTools).not.toHaveBeenCalled();
  });

  it('opens the update notification directly for tray update checks', () => {
    platformMocks.isElectronDesktopMock.mockReturnValue(true);
    const openListener = vi.fn();
    window.addEventListener('aionui-open-update-modal', openListener);

    try {
      renderLayout();

      window.dispatchEvent(new Event('tray:check-update'));

      expect(navigate).not.toHaveBeenCalled();
      expect(openListener).toHaveBeenCalledTimes(1);
      const event = openListener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({ source: 'tray' });
    } finally {
      window.removeEventListener('aionui-open-update-modal', openListener);
    }
  });
});
