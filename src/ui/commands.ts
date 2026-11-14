import type { Controller } from '../app/controller';
import type { Instruments } from '../instruments/instruments';
import type { SheetDialog } from './dialogs';
import type { Legend } from './legend';
import type { PinAddress } from './pin-address';
import type { KeyCommand } from './shortcuts';
import type { Tools } from './tools';

export interface CommandTargets {
  controller: Controller;
  instruments: Pick<Instruments, 'placeTripEndAtCenter'>;
  tools: Pick<Tools, 'holdHideKey'>;
  legend: Pick<Legend, 'togglePicker'>;
  shortcutsDialog: Pick<SheetDialog, 'open'>;
  pinAddress: Pick<PinAddress, 'openMenu'>;
  copyLink: () => void;
  leaveMode: () => void;
}

/** Carries out what a key in the keyboard table stands for. */
export function runCommand(command: KeyCommand, targets: CommandTargets): void {
  const { controller } = targets;
  switch (command.do) {
    case 'pan':
      return controller.panBy(command.dx, command.dy);
    case 'zoom':
      return controller.zoomBy(command.delta);
    case 'slide':
      return controller.slideBy(command.dx, command.dy);
    case 'turn':
      return controller.turnBy(command.degrees);
    case 'squareUp':
      return controller.squareUp();
    case 'toggleSlide':
      return controller.toggleSlide();
    case 'toggleMeasure':
      return controller.toggleMeasure();
    case 'toggleDrive':
      return controller.toggleDrive();
    case 'placeTripEnd':
      return targets.instruments.placeTripEndAtCenter();
    case 'toggleRings':
      return controller.toggleRings();
    case 'holdHideHome':
      return targets.tools.holdHideKey(true);
    case 'swap':
      return controller.swap();
    case 'lineUpAgain':
      return controller.lineUpAgain();
    case 'pinAtCenter':
      return controller.pinAtCenter();
    case 'openPinMenu':
      return targets.pinAddress.openMenu('collar');
    case 'toggleUnits':
      return controller.toggleUnits();
    case 'toggleGround':
      return controller.toggleGround();
    case 'copyLink':
      return targets.copyLink();
    case 'pickHome':
      return targets.legend.togglePicker('home');
    case 'pickAway':
      return targets.legend.togglePicker('away');
    case 'showShortcuts':
      return targets.shortcutsDialog.open();
    case 'cancel':
      return targets.leaveMode();
  }
}
