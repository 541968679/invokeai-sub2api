import { Box, Flex, forwardRef, Grid, GridItem, Spinner, Text } from '@invoke-ai/ui-library';
import { createSelector } from '@reduxjs/toolkit';
import { useAppSelector, useAppStore } from 'app/store/storeHooks';
import { getFocusedRegion, useIsRegionFocused } from 'common/hooks/focus';
import { useRangeBasedImageFetching } from 'features/gallery/hooks/useRangeBasedImageFetching';
import type { selectGetImageNamesQueryArgs } from 'features/gallery/store/gallerySelectors';
import {
  selectGalleryImageMinimumWidth,
  selectImageToCompare,
  selectLastSelectedItem,
  selectSelection,
  selectSelectionCount,
} from 'features/gallery/store/gallerySelectors';
import { imageToCompareChanged, selectionChanged } from 'features/gallery/store/gallerySlice';
import { useRegisteredHotkeys } from 'features/system/components/HotkeysModal/useHotkeyData';
import { navigationApi } from 'features/ui/layouts/navigation-api';
import { VIEWER_PANEL_ID } from 'features/ui/layouts/shared';
import { selectActiveTab } from 'features/ui/store/uiSelectors';
import type { MutableRefObject, RefObject } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  GridComponents,
  GridComputeItemKey,
  GridItemContent,
  ListRange,
  ScrollSeekConfiguration,
  VirtuosoGridHandle,
} from 'react-virtuoso';
import { VirtuosoGrid } from 'react-virtuoso';
import { imagesApi, useImageDTO, useStarImagesMutation, useUnstarImagesMutation } from 'services/api/endpoints/images';
import type { S } from 'services/api/types';
import { useDebounce } from 'use-debounce';

import { getItemIndex } from './getItemIndex';
import { getItemsPerRow } from './getItemsPerRow';
import { GalleryImage, GalleryImagePlaceholder } from './ImageGrid/GalleryImage';
import { GalleryQueuePlaceholder } from './ImageGrid/GalleryQueuePlaceholder';
import { GallerySelectionCountTag } from './ImageGrid/GallerySelectionCountTag';
import { scrollIntoView } from './scrollIntoView';
import { useGalleryImageNames } from './use-gallery-image-names';
import { useGalleryQueuePlaceholders } from './use-gallery-queue-placeholders';
import { useScrollableGallery } from './useScrollableGallery';

type ListImageNamesQueryArgs = ReturnType<typeof selectGetImageNamesQueryArgs>;
type GalleryGridItem =
  | { type: 'image'; imageName: string }
  | { type: 'queue-placeholder'; item: S['SessionQueueItem'] };

type GridContext = {
  queryArgs: ListImageNamesQueryArgs;
  imageNames: string[];
  now: number;
};

/**
 * Wraps an image - either the placeholder as it is being loaded or the loaded image
 */
const ImageAtPosition = memo(({ imageName }: { index: number; imageName: string }) => {
  /*
   * We rely on the useRangeBasedImageFetching to fetch all image DTOs, caching them with RTK Query.
   *
   * In this component, we just want to consume that cache. Unforutnately, RTK Query does not provide a way to
   * subscribe to a query without triggering a new fetch.
   *
   * There is a hack, though:
   * - https://github.com/reduxjs/redux-toolkit/discussions/4213
   *
   * This essentially means "subscribe to the query once it has some data".
   *
   * One issue with this approach. When an item DTO is already cached - for example, because it is selected and
   * rendered in the viewer - it will show up in the grid before the other items have loaded. This is most
   * noticeable when first loading a board. The first item in the board is selected and rendered immediately in
   * the viewer, caching the DTO. The gallery grid renders, and that first item displays as a thumbnail while the
   * others are still placeholders. After a moment, the rest of the items load up and display as thumbnails.
   */

  // Use `currentData` instead of `data` to prevent a flash of previous image rendered at this index
  const { currentData: imageDTO, isUninitialized } = imagesApi.endpoints.getImageDTO.useQueryState(imageName);
  imagesApi.endpoints.getImageDTO.useQuerySubscription(imageName, { skip: isUninitialized });

  if (!imageDTO) {
    return <GalleryImagePlaceholder data-item-id={imageName} />;
  }

  return <GalleryImage imageDTO={imageDTO} />;
});
ImageAtPosition.displayName = 'ImageAtPosition';

const GalleryItemAtPosition = memo(({ item, now }: { index: number; item: GalleryGridItem; now: number }) => {
  if (item.type === 'queue-placeholder') {
    return <GalleryQueuePlaceholder item={item.item} now={now} />;
  }
  return <ImageAtPosition index={0} imageName={item.imageName} />;
});
GalleryItemAtPosition.displayName = 'GalleryItemAtPosition';

const computeItemKey: GridComputeItemKey<GalleryGridItem, GridContext> = (index, item, { queryArgs }) => {
  if (item.type === 'queue-placeholder') {
    return `queue-placeholder-${item.item.item_id}`;
  }
  return `${JSON.stringify(queryArgs)}-${item.imageName ?? index}`;
};

const canHandleGridArrowNavigation = (
  activeTab: ReturnType<typeof selectActiveTab>,
  focusedRegion: ReturnType<typeof getFocusedRegion>
) => {
  if (navigationApi.isViewerArrowNavigationMode(activeTab)) {
    // When gallery is not effectively available, viewer hotkeys own left/right navigation.
    return false;
  }

  if (focusedRegion === 'gallery' || focusedRegion === 'viewer') {
    return true;
  }

  // Fallback for tab-switch edge case: allow nav when viewer dock tab is active before first click.
  return navigationApi.isDockviewPanelActive(activeTab, VIEWER_PANEL_ID);
};

/**
 * Handles keyboard navigation for the gallery.
 */
const useKeyboardNavigation = (
  navigationImageNames: string[],
  virtuosoRef: RefObject<VirtuosoGridHandle>,
  rootRef: RefObject<HTMLDivElement>
) => {
  const { dispatch, getState } = useAppStore();
  const activeTab = useAppSelector(selectActiveTab);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const focusedRegion = getFocusedRegion();
      if (!canHandleGridArrowNavigation(activeTab, focusedRegion)) {
        return;
      }

      // Only handle arrow keys
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        return;
      }
      // Don't interfere if user is typing in an input
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      const rootEl = rootRef.current;
      const virtuosoGridHandle = virtuosoRef.current;

      if (!rootEl || !virtuosoGridHandle) {
        return;
      }

      if (navigationImageNames.length === 0) {
        return;
      }

      const imagesPerRow = getItemsPerRow(rootEl);

      if (imagesPerRow === 0) {
        // This can happen if the grid is not yet rendered or has no items
        return;
      }

      event.preventDefault();

      const state = getState();
      const imageName = event.altKey
        ? // When the user holds alt, we are changing the image to compare - if no image to compare is currently selected,
          // we start from the last selected image
          (selectImageToCompare(state) ?? selectLastSelectedItem(state))
        : selectLastSelectedItem(state);

      const currentIndex = getItemIndex(imageName ?? null, navigationImageNames);

      let newIndex = currentIndex;

      switch (event.key) {
        case 'ArrowLeft':
          if (currentIndex > 0) {
            newIndex = currentIndex - 1;
            // } else {
            //   // Wrap to last image
            //   newIndex = imageNames.length - 1;
          }
          break;
        case 'ArrowRight':
          if (currentIndex < navigationImageNames.length - 1) {
            newIndex = currentIndex + 1;
            // } else {
            //   // Wrap to first image
            //   newIndex = 0;
          }
          break;
        case 'ArrowUp':
          // If on first row, stay on current image
          if (currentIndex < imagesPerRow) {
            newIndex = currentIndex;
          } else {
            newIndex = Math.max(0, currentIndex - imagesPerRow);
          }
          break;
        case 'ArrowDown':
          // If no images below, stay on current image
          if (currentIndex >= navigationImageNames.length - imagesPerRow) {
            newIndex = currentIndex;
          } else {
            newIndex = Math.min(navigationImageNames.length - 1, currentIndex + imagesPerRow);
          }
          break;
      }

      if (newIndex !== currentIndex && newIndex >= 0 && newIndex < navigationImageNames.length) {
        const newImageName = navigationImageNames[newIndex];
        if (newImageName) {
          if (event.altKey) {
            dispatch(imageToCompareChanged(newImageName));
          } else {
            dispatch(selectionChanged([newImageName]));
          }
        }
      }
    },
    [activeTab, rootRef, virtuosoRef, navigationImageNames, getState, dispatch]
  );

  useRegisteredHotkeys({
    id: 'galleryNavLeft',
    category: 'gallery',
    callback: handleKeyDown,
    options: { preventDefault: true },
    dependencies: [handleKeyDown],
  });

  useRegisteredHotkeys({
    id: 'galleryNavRight',
    category: 'gallery',
    callback: handleKeyDown,
    options: { preventDefault: true },
    dependencies: [handleKeyDown],
  });

  useRegisteredHotkeys({
    id: 'galleryNavUp',
    category: 'gallery',
    callback: handleKeyDown,
    options: { preventDefault: true },
    dependencies: [handleKeyDown],
  });

  useRegisteredHotkeys({
    id: 'galleryNavDown',
    category: 'gallery',
    callback: handleKeyDown,
    options: { preventDefault: true },
    dependencies: [handleKeyDown],
  });

  useRegisteredHotkeys({
    id: 'galleryNavLeftAlt',
    category: 'gallery',
    callback: handleKeyDown,
    options: { preventDefault: true },
    dependencies: [handleKeyDown],
  });

  useRegisteredHotkeys({
    id: 'galleryNavRightAlt',
    category: 'gallery',
    callback: handleKeyDown,
    options: { preventDefault: true },
    dependencies: [handleKeyDown],
  });

  useRegisteredHotkeys({
    id: 'galleryNavUpAlt',
    category: 'gallery',
    callback: handleKeyDown,
    options: { preventDefault: true },
    dependencies: [handleKeyDown],
  });

  useRegisteredHotkeys({
    id: 'galleryNavDownAlt',
    category: 'gallery',
    callback: handleKeyDown,
    options: { preventDefault: true },
    dependencies: [handleKeyDown],
  });
};

/**
 * Keeps the last selected image in view when the gallery is scrolled.
 * This is useful for keyboard navigation and ensuring the user can see their selection.
 * It only tracks the last selected image, not the image to compare.
 */
const useKeepSelectedImageInView = (
  imageNames: string[],
  virtuosoRef: RefObject<VirtuosoGridHandle>,
  rootRef: RefObject<HTMLDivElement>,
  rangeRef: MutableRefObject<ListRange>
) => {
  const selection = useAppSelector(selectSelection);

  useEffect(() => {
    const targetImageName = selection.at(-1);
    const virtuosoGridHandle = virtuosoRef.current;
    const rootEl = rootRef.current;
    const range = rangeRef.current;

    if (!virtuosoGridHandle || !rootEl || !targetImageName || !imageNames || imageNames.length === 0) {
      return;
    }

    if (!imageNames.includes(targetImageName)) {
      return;
    }

    setTimeout(() => {
      scrollIntoView(targetImageName, imageNames, rootEl, virtuosoGridHandle, range);
    }, 0);
  }, [imageNames, rangeRef, rootRef, virtuosoRef, selection]);
};

const useStarImageHotkey = () => {
  const lastSelectedItem = useAppSelector(selectLastSelectedItem);
  const selectionCount = useAppSelector(selectSelectionCount);
  const isGalleryFocused = useIsRegionFocused('gallery');
  const imageDTO = useImageDTO(lastSelectedItem);
  const [starImages] = useStarImagesMutation();
  const [unstarImages] = useUnstarImagesMutation();

  const handleStarHotkey = useCallback(() => {
    if (!imageDTO) {
      return;
    }
    if (!isGalleryFocused) {
      return;
    }
    if (imageDTO.starred) {
      unstarImages({ image_names: [imageDTO.image_name] });
    } else {
      starImages({ image_names: [imageDTO.image_name] });
    }
  }, [imageDTO, isGalleryFocused, starImages, unstarImages]);

  useRegisteredHotkeys({
    id: 'starImage',
    category: 'gallery',
    callback: handleStarHotkey,
    options: { enabled: !!imageDTO && selectionCount === 1 && isGalleryFocused },
    dependencies: [imageDTO, selectionCount, isGalleryFocused, handleStarHotkey],
  });
};

type GalleryImageGridContentProps = {
  imageNames: string[];
  navigationImageNames?: string[];
  isLoading: boolean;
  queryArgs: ListImageNamesQueryArgs;
  rootRef?: RefObject<HTMLDivElement>;
};

export const GalleryImageGridContent = memo(
  ({ imageNames, navigationImageNames, isLoading, queryArgs, rootRef: rootRefProp }: GalleryImageGridContentProps) => {
    const { t } = useTranslation();
    const virtuosoRef = useRef<VirtuosoGridHandle>(null);
    const rangeRef = useRef<ListRange>({ startIndex: 0, endIndex: 0 });
    const internalRootRef = useRef<HTMLDivElement>(null);
    const rootRef = rootRefProp ?? internalRootRef;
    const { placeholders, now } = useGalleryQueuePlaceholders();
    const galleryItems = useMemo<GalleryGridItem[]>(
      () => [
        ...placeholders.map((item) => ({ type: 'queue-placeholder' as const, item })),
        ...imageNames.map((imageName) => ({ type: 'image' as const, imageName })),
      ],
      [imageNames, placeholders]
    );

    // Use range-based fetching for bulk loading image DTOs into cache based on the visible range
    const { onRangeChanged } = useRangeBasedImageFetching({
      imageNames,
      enabled: !isLoading,
    });

    useStarImageHotkey();
    useKeepSelectedImageInView(imageNames, virtuosoRef, rootRef, rangeRef);
    useKeyboardNavigation(navigationImageNames ?? imageNames, virtuosoRef, rootRef);
    const scrollerRef = useScrollableGallery(rootRef);

    /*
     * We have to keep track of the visible range for keep-selected-image-in-view functionality and push the range to
     * the range-based image fetching hook.
     */
    const handleRangeChanged = useCallback(
      (range: ListRange) => {
        rangeRef.current = range;
        onRangeChanged({
          startIndex: Math.max(0, range.startIndex - placeholders.length),
          endIndex: Math.max(0, range.endIndex - placeholders.length),
        });
      },
      [onRangeChanged, placeholders.length]
    );

    const context = useMemo<GridContext>(() => ({ imageNames, now, queryArgs }), [imageNames, now, queryArgs]);

    if (isLoading) {
      return (
        <Flex w="full" h="full" alignItems="center" justifyContent="center" gap={4}>
          <Spinner size="lg" opacity={0.3} />
          <Text color="base.300">{t('gallery.loadingGallery')}</Text>
        </Flex>
      );
    }

    if (galleryItems.length === 0) {
      return (
        <Flex w="full" h="full" alignItems="center" justifyContent="center">
          <Text color="base.300">{t('gallery.noImagesFound')}</Text>
        </Flex>
      );
    }

    return (
      // This wrapper component is necessary to initialize the overlay scrollbars!
      <Box data-overlayscrollbars-initialize="" ref={rootRef} position="relative" w="full" h="full">
        <VirtuosoGrid<GalleryGridItem, GridContext>
          ref={virtuosoRef}
          context={context}
          data={galleryItems}
          increaseViewportBy={4096}
          itemContent={itemContent}
          computeItemKey={computeItemKey}
          components={components}
          style={style}
          scrollerRef={scrollerRef}
          scrollSeekConfiguration={scrollSeekConfiguration}
          rangeChanged={handleRangeChanged}
        />
        <GallerySelectionCountTag imageNames={imageNames} />
      </Box>
    );
  }
);

GalleryImageGridContent.displayName = 'GalleryImageGridContent';

export const GalleryImageGrid = memo(() => {
  const { queryArgs, imageNames, isLoading } = useGalleryImageNames();
  return <GalleryImageGridContent imageNames={imageNames} isLoading={isLoading} queryArgs={queryArgs} />;
});

GalleryImageGrid.displayName = 'GalleryImageGrid';

const scrollSeekConfiguration: ScrollSeekConfiguration = {
  enter: (velocity) => {
    return Math.abs(velocity) > 2048;
  },
  exit: (velocity) => {
    return velocity === 0;
  },
};

// Styles
const style = { height: '100%', width: '100%' };

const selectGridTemplateColumns = createSelector(
  selectGalleryImageMinimumWidth,
  (galleryImageMinimumWidth) => `repeat(auto-fill, minmax(${galleryImageMinimumWidth}px, 1fr))`
);

// Grid components
const ListComponent: GridComponents<GridContext>['List'] = forwardRef(({ context: _, ...rest }, ref) => {
  const _gridTemplateColumns = useAppSelector(selectGridTemplateColumns);
  const [gridTemplateColumns] = useDebounce(_gridTemplateColumns, 300);

  return <Grid ref={ref} gridTemplateColumns={gridTemplateColumns} gap={1} {...rest} />;
});
ListComponent.displayName = 'ListComponent';

const itemContent: GridItemContent<GalleryGridItem, GridContext> = (index, item, { now }) => {
  return <GalleryItemAtPosition index={index} item={item} now={now} />;
};

const ItemComponent: GridComponents<GridContext>['Item'] = forwardRef(({ context: _, ...rest }, ref) => (
  <GridItem ref={ref} aspectRatio="1/1" {...rest} />
));
ItemComponent.displayName = 'ItemComponent';

const ScrollSeekPlaceholderComponent: GridComponents<GridContext>['ScrollSeekPlaceholder'] = (props) => (
  <GridItem aspectRatio="1/1" {...props}>
    <GalleryImagePlaceholder />
  </GridItem>
);

ScrollSeekPlaceholderComponent.displayName = 'ScrollSeekPlaceholderComponent';

const components: GridComponents<GridContext> = {
  Item: ItemComponent,
  List: ListComponent,
  ScrollSeekPlaceholder: ScrollSeekPlaceholderComponent,
};
