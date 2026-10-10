describe('Mermaid Viewer', () => {
  it('loads the diagram, filters and syncs with URL', () => {
    // Visit the app with an explicit file: with no `file` param the app
    // auto-selects the first file in the directory, which is not main.mmd.
    cy.visit('/?file=main.mmd');
    
    // Check if files are listed
    cy.contains('main.mmd').should('be.visible');

    // Wait for the diagram to render
    cy.get('#diagram-container svg').should('exist');

    // Verify initial content (e.g., 'POST /login')
    cy.get('#diagram-container').contains('POST /login').should('exist');

    // Toggle flow=login off (scope to the region-tree label: the bare text
    // 'flow' also matches ancestor containers holding every checkbox)
    cy.contains('label', 'flow=login').find('input[type="checkbox"]').click();

    // Verify it's removed from the diagram
    cy.get('#diagram-container').contains('POST /login').should('not.exist');

    // Verify URL updated
    cy.url().should('include', 'hidden=flow%3Dlogin');

    // Search for something. The input is controlled by the `q` URL param and
    // each keystroke round-trips through the router, so type slowly enough
    // for the URL state to catch up between keystrokes.
    cy.get('input[placeholder="Search diagram..."]').type('Fetch User Data', { delay: 250 });
    
    // Check URL for search query
    cy.url().should('include', 'q=Fetch+User+Data');
  });
});
