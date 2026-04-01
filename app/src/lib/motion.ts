export const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

export const pageTransition = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 30,
  duration: 0.3,
}

export const staggerContainer = {
  animate: {
    transition: { staggerChildren: 0.06 },
  },
}

export const staggerItem = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
}

export const staggerTransition = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
}

export const hoverLift = {
  whileHover: { y: -4 },
  transition: { type: 'spring' as const, stiffness: 400, damping: 25 },
}

export const canvasSlideIn = {
  initial: { x: 40, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
}
