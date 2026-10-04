describe('Mermaid Viewer', () => {
  it('loads the diagram, filters and syncs with URL', () => {
    // Visit the app
    cy.visit('/');
    
    // Check if files are listed
    cy.contains('main.mmd').should('be.visible');

    // Wait for the diagram to render
    cy.get('#diagram-container svg').should('exist');

    // Verify initial content (e.g., 'POST /login')
    cy.get('#diagram-container').contains('POST /login').should('exist');

    // Toggle flow=login off
    cy.contains('flow').parent().find('input[type="checkbox"]').click();

    // Verify it's removed from the diagram
    cy.get('#diagram-container').contains('POST /login').should('not.exist');

    // Verify URL updated
    cy.url().should('include', 'hidden=flow%3Dlogin');

    // Search for something
    cy.get('input[placeholder="Search diagram..."]').type('Fetch User Data');
    
    // Check URL for search query
    cy.url().should('include', 'q=Fetch+User+Data');
  });
});
