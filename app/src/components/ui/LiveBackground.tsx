'use client'

export function LiveBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      {/* Orb 1 — primary blue */}
      <div
        className="absolute w-[600px] h-[600px] rounded-full opacity-[0.15] blur-[120px] will-change-transform"
        style={{
          background: '#0071E3',
          top: '-10%',
          left: '-5%',
          animation: 'float-orb-1 25s ease-in-out infinite',
        }}
      />
      {/* Orb 2 — secondary purple */}
      <div
        className="absolute w-[500px] h-[500px] rounded-full opacity-[0.10] blur-[120px] will-change-transform"
        style={{
          background: '#4A47D2',
          bottom: '-10%',
          right: '-5%',
          animation: 'float-orb-2 30s ease-in-out infinite',
        }}
      />
      {/* Orb 3 — tertiary teal */}
      <div
        className="absolute w-[400px] h-[400px] rounded-full opacity-[0.07] blur-[120px] will-change-transform"
        style={{
          background: '#00637F',
          top: '40%',
          left: '30%',
          animation: 'float-orb-3 35s ease-in-out infinite',
        }}
      />
    </div>
  )
}
