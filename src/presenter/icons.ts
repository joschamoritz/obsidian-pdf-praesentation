// Lucide-Symbole (ISC-Lizenz), beim Bauen als Text eingebettet.
import chevronLeft from 'lucide-static/icons/chevron-left.svg';
import chevronRight from 'lucide-static/icons/chevron-right.svg';
import circle from 'lucide-static/icons/circle.svg';
import circleDot from 'lucide-static/icons/circle-dot.svg';
import eraser from 'lucide-static/icons/eraser.svg';
import filePlus from 'lucide-static/icons/file-plus-2.svg';
import hand from 'lucide-static/icons/hand.svg';
import highlighter from 'lucide-static/icons/highlighter.svg';
import layoutGrid from 'lucide-static/icons/layout-grid.svg';
import monitor from 'lucide-static/icons/monitor.svg';
import lock from 'lucide-static/icons/lock.svg';
import lockOpen from 'lucide-static/icons/lock-open.svg';
import moveUpRight from 'lucide-static/icons/move-up-right.svg';
import pen from 'lucide-static/icons/pen.svg';
import pin from 'lucide-static/icons/pin.svg';
import pinOff from 'lucide-static/icons/pin-off.svg';
import plus from 'lucide-static/icons/plus.svg';
import redo from 'lucide-static/icons/redo-2.svg';
import shapes from 'lucide-static/icons/shapes.svg';
import slash from 'lucide-static/icons/slash.svg';
import sliders from 'lucide-static/icons/sliders-horizontal.svg';
import square from 'lucide-static/icons/square.svg';
import timer from 'lucide-static/icons/timer.svg';
import trash from 'lucide-static/icons/trash-2.svg';
import undo from 'lucide-static/icons/undo-2.svg';
import close from 'lucide-static/icons/x.svg';

export const icons = {
  arrow: moveUpRight,
  chevronLeft,
  chevronRight,
  close,
  ellipse: circle,
  eraser,
  filePlus,
  hand,
  highlighter,
  laser: circleDot,
  layoutGrid,
  line: slash,
  lock,
  lockOpen,
  monitor,
  pen,
  pin,
  pinOff,
  plus,
  rectangle: square,
  redo,
  shapes,
  sliders,
  timer,
  trash,
  undo,
};

export type IconName = keyof typeof icons;
