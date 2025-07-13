// MCP Search Integration - Enhanced for intelligent context
      if (isSearchQuery) {
        console.log('✅ Search query detected, calling MCP...'); // ADD THIS
        try {
          console.log('Using MCP for smart search...');
          
          // First, search for brands
          const brandResults = await callMCPSearch(userMessage, projectId || 'HB-PitchAssist', 10);
          
          // Also search for relevant meetings if the query mentions projects or discussions
          let meetingResults = null;
          if (userMessage.toLowerCase().includes('project') || 
              userMessage.toLowerCase().includes('pending') ||
              userMessage.toLowerCase().includes('discussed')) {
            meetingResults = await callMCPSearch('meeting discussion ' + userMessage, projectId || 'HB-PitchAssist', 5);
          }
          
          console.log('📊 Brand results:', brandResults);
          console.log('📊 Meeting results:', meetingResults);
          
          // Build intelligent context from results
          let mcpContext = '\n\n🎯 PRIORITY CONTEXT FROM YOUR BUSINESS DATA:\n\n';
          
          // Add brand information with business intelligence
          if (brandResults && !brandResults.error && brandResults.matches.length > 0) {
            mcpContext += '**ACTIVE BRANDS IN YOUR PIPELINE:**\n';
            
            brandResults.matches.forEach(brand => {
              const lastModDate = new Date(brand.lastModified);
              const daysSinceModified = Math.floor((Date.now() - lastModDate) / (1000 * 60 * 60 * 24));
              
              mcpContext += `\n🔥 ${brand.name}`;
              
              // Add urgency indicators
              if (daysSinceModified < 7) {
                mcpContext += ' [HOT - Updated this week!]';
              } else if (daysSinceModified < 30) {
                mcpContext += ' [WARM - Recent activity]';
              }
              
              mcpContext += `\n   • Category: ${brand.category}\n   • Budget: ${brand.budget}`;
              
              if (brand.campaignSummary) {
                mcpContext += `\n   • Current Focus: ${brand.campaignSummary}`;
              }
              
              // Smart insights based on budget
              const budgetNum = parseInt(brand.budget.replace(/[^0-9]/g, ''));
              if (budgetNum >= 5000000) {
                mcpContext += '\n   • 💰 HIGH-VALUE OPPORTUNITY - Prioritize for major integrations';
              } else if (budgetNum >= 1000000) {
                mcpContext += '\n   • 💎 SOLID BUDGET - Good for featured placements';
              }
              
              mcpContext += '\n';
            });
          }
          
          // Add meeting context for business intelligence
          if (meetingResults && !meetingResults.error && meetingResults.matches.length > 0) {
            mcpContext += '\n**RECENT DISCUSSIONS & PENDING DEALS:**\n';
            
            meetingResults.matches.forEach(meeting => {
              const meetingDate = new Date(meeting.date);
              const daysSinceMeeting = Math.floor((Date.now() - meetingDate) / (1000 * 60 * 60 * 24));
              
              // Only include recent and relevant meetings
              if (daysSinceMeeting < 30 && 
                  (meeting.summary.toLowerCase().includes('brand') || 
                   meeting.summary.toLowerCase().includes('integration') ||
                   meeting.summary.toLowerCase().includes('partnership'))) {
                
                mcpContext += `\n📅 ${meeting.title} (${meeting.date})`;
                
                if (daysSinceMeeting < 7) {
                  mcpContext += ' [THIS WEEK]';
                }
                
                // Extract key insights from summary
                const summaryLower = meeting.summary.toLowerCase();
                if (summaryLower.includes('approved') || summaryLower.includes('green light')) {
                  mcpContext += '\n   ✅ APPROVED/GREEN LIT';
                }
                if (summaryLower.includes('pending') || summaryLower.includes('waiting')) {
                  mcpContext += '\n   ⏳ PENDING DECISION';
                }
                if (summaryLower.includes('budget') || summaryLower.includes('$')) {
                  mcpContext += '\n   💵 BUDGET DISCUSSED';
                }
                
                mcpContext += `\n   • Key Points: ${meeting.summary}\n`;
              }
            });
          }
          
          // Add strategic instructions
          mcpContext += '\n**INTEGRATION STRATEGY INSTRUCTIONS:**\n';
          mcpContext += '1. PRIORITIZE brands marked as HOT or with recent meeting discussions\n';
          mcpContext += '2. Consider pending deals from meetings when suggesting integrations\n';
          mcpContext += '3. Match high-budget brands with hero/featured integrations\n';
          mcpContext += '4. If a brand was recently discussed in meetings, reference that context\n';
          mcpContext += '5. Flag any brands that are close to closing (based on meeting summaries)\n';
          
          // Add to system message BEFORE the knowledge base
          systemMessageContent = systemMessageContent.replace(
            'You are a helpful assistant specialized in AI & Automation.',
            'You are a helpful assistant specialized in AI & Automation.' + mcpContext
          );
        } catch (error) {
          console.error('MCP search error:', error);
        }
      }
