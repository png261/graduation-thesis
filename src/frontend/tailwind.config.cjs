const assistantUiPlugin =
  require("@assistant-ui/react-ui/tailwindcss").default;

module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
  	extend: {
  		colors: {
  			ink: '#0f172a',
  			clay: '#f5efe6',
  			haze: '#f8f7f4',
  			tide: '#0f766e',
  			mist: '#e7e5e4'
  		},
  		fontFamily: {
  			display: [
  				'Space Grotesk',
  				'system-ui',
  				'sans-serif'
  			]
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  plugins: [assistantUiPlugin({ components: ["thread"] }), require("tailwindcss-animate")]
};
