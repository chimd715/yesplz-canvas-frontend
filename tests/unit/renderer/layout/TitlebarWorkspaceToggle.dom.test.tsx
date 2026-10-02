import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ desktop: true, mac: false, mobile: false }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: { invoke: vi.fn().mockResolvedValue({ id: 'test', type: 'aionrs', name: 'Project design' }) },
    },
  },
}));
vi.mock('@/common/config/constants', () => ({ TEAM_MODE_ENABLED: false }));
vi.mock('@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({ default: () => null }));
vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: undefined }),
}));
vi.mock('@/renderer/components/agent/AgentBadge', () => ({
  AgentLogoIcon: () => <span aria-hidden='true'>logo</span>,
}));
vi.mock('@/renderer/components/layout/WindowControls', () => ({
  default: () => <div data-testid='window-controls' />,
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: platform.mobile }),
}));
vi.mock('@/renderer/hooks/context/NavigationHistoryContext', () => ({
  useNavigationHistory: () => null,
}));
vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({
  useFeedback: () => ({ openFeedback: vi.fn() }),
}));
vi.mock('@/renderer/services/feedback/resolveFeedbackModule', () => ({
  resolveFeedbackModule: () => 'conversation-session',
}));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => platform.desktop,
  isMacOS: () => platform.mac,
}));

import Titlebar from '@/renderer/components/layout/Titlebar';
import { WORKSPACE_STATE_EVENT } from '@/renderer/utils/workspace/workspaceEvents';
const CurrentRoute = () => <span data-testid='current-route'>{useLocation().pathname}</span>;
const renderTitlebar = (workspaceAvailable = true, route = '/conversation/test') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Titlebar workspaceAvailable={workspaceAvailable} />
      <CurrentRoute />
    </MemoryRouter>
  );

describe('Titlebar workspace toggle', () => {
  beforeEach(() => {
    platform.desktop = true;
    platform.mac = false;
    platform.mobile = false;
  });

  it('places the Windows workspace toggle directly after Bug Report', () => {
    renderTitlebar();

    const report = screen.getByRole('button', { name: 'conversation.welcome.quickActionFeedback' });
    const workspace = screen.getByRole('button', { name: 'common.expandMore' });

    expect(report.nextElementSibling).toBe(workspace);
    expect(workspace.nextElementSibling).toBe(screen.getByTestId('window-controls'));
  });

  it.each([
    { runtime: 'macOS desktop', desktop: true, mac: true },
    { runtime: 'WebUI', desktop: false, mac: false },
  ])('keeps the workspace toggle after Bug Report on $runtime', ({ desktop, mac }) => {
    platform.desktop = desktop;
    platform.mac = mac;
    renderTitlebar();

    const report = screen.getByRole('button', { name: 'conversation.welcome.quickActionFeedback' });
    const workspace = screen.getByRole('button', { name: 'common.expandMore' });

    expect(report.nextElementSibling).toBe(workspace);
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument();
  });

  it('updates the workspace action when the panel becomes expanded', () => {
    renderTitlebar();

    act(() => {
      window.dispatchEvent(new CustomEvent(WORKSPACE_STATE_EVENT, { detail: { collapsed: false } }));
    });

    expect(screen.getByRole('button', { name: 'common.collapse' })).toBeInTheDocument();
  });

  it('omits the workspace toggle when no workspace is available', () => {
    renderTitlebar(false);

    expect(screen.queryByRole('button', { name: 'common.expandMore' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common.collapse' })).not.toBeInTheDocument();
  });
  it('lets a mobile conversation brand navigate home while preserving the displayed conversation title', async () => {
    platform.desktop = false;
    platform.mobile = true;
    renderTitlebar();
    expect(await screen.findByText('Project design')).toBeInTheDocument();
    const brand = screen.getByRole('link', { name: 'login.brand' });
    expect(brand).toHaveAttribute('href', '/guid');
    fireEvent.click(brand);
    expect(screen.getByTestId('current-route')).toHaveTextContent('/guid');
  });
  it('lets the mobile product brand activate with Enter outside a conversation', async () => {
    platform.desktop = false;
    platform.mobile = true;
    renderTitlebar(false, '/settings/model');
    const brand = screen.getByRole('link', { name: 'login.brand' });
    brand.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('current-route')).toHaveTextContent('/guid');
  });
});
