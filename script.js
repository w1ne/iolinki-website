document.addEventListener('DOMContentLoaded', () => {
    // Basic Reveal Animation on Scroll
    const observerOptions = {
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('reveal-visible');
            }
        });
    }, observerOptions);

    document.querySelectorAll('.feature-card, .pricing-card, .tech-info, .terminal-card').forEach(el => {
        el.classList.add('reveal-hidden');
        observer.observe(el);
    });

    // Logo click scroll to top
    document.querySelector('.logo').addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
});
