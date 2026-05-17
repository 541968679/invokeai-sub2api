import { Divider, Flex, IconButton, Spacer, Tooltip } from '@invoke-ai/ui-library';
import { useAppSelector } from 'app/store/storeHooks';
import { UserMenu } from 'features/auth/components/UserMenu';
import { selectCurrentUser } from 'features/auth/store/authSlice';
import { useIsCustomNodesEnabled } from 'features/customNodes/useIsCustomNodesEnabled';
import InvokeAILogoComponent from 'features/system/components/InvokeAILogoComponent';
import SettingsMenu from 'features/system/components/SettingsModal/SettingsMenu';
import StatusIndicator from 'features/system/components/StatusIndicator';
import { VideosModalButton } from 'features/system/components/VideosModal/VideosModalButton';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PiBoundingBoxBold,
  PiCircuitryBold,
  PiCubeBold,
  PiFlowArrowBold,
  PiFrameCornersBold,
  PiQueueBold,
  PiTextAaBold,
  PiUsersBold,
} from 'react-icons/pi';
import { useNavigate } from 'react-router-dom';

import { Notifications } from './Notifications';
import { TabButton } from './TabButton';

export const VerticalNavBar = memo(() => {
  const { t } = useTranslation();
  const { isAllowed: isCustomNodesAllowed } = useIsCustomNodesEnabled();
  const user = useAppSelector(selectCurrentUser);
  const navigate = useNavigate();
  const handleUserManagement = useCallback(() => {
    navigate('/admin/users');
  }, [navigate]);

  return (
    <Flex flexDir="column" alignItems="center" py={6} ps={4} pe={2} gap={4} minW={0} flexShrink={0}>
      <InvokeAILogoComponent />

      <Flex gap={6} pt={6} h="full" flexDir="column">
        <TabButton tab="generate" icon={<PiTextAaBold />} label={t('ui.tabs.generate')} />
        <TabButton tab="canvas" icon={<PiBoundingBoxBold />} label={t('ui.tabs.canvas')} />
        <TabButton tab="upscaling" icon={<PiFrameCornersBold />} label={t('ui.tabs.upscaling')} />
        <TabButton tab="workflows" icon={<PiFlowArrowBold />} label={t('ui.tabs.workflows')} />
      </Flex>

      <Spacer />

      <StatusIndicator />
      <TabButton tab="models" icon={<PiCubeBold />} label={t('ui.tabs.models')} />
      {isCustomNodesAllowed && (
        <TabButton tab="customNodes" icon={<PiCircuitryBold />} label={t('ui.tabs.customNodes')} />
      )}
      <TabButton tab="queue" icon={<PiQueueBold />} label={t('ui.tabs.queue')} />

      <Divider />

      {user?.is_admin && (
        <Tooltip label={t('auth.userManagement.menuItem')} placement="end">
          <IconButton
            aria-label={t('auth.userManagement.menuItem')}
            icon={<PiUsersBold />}
            size="md"
            fontSize="24px"
            variant="link"
            onClick={handleUserManagement}
          />
        </Tooltip>
      )}
      <UserMenu />
      <Notifications />
      <VideosModalButton />
      <SettingsMenu />
    </Flex>
  );
});

VerticalNavBar.displayName = 'VerticalNavBar';
