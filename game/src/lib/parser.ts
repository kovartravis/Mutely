import { LLMAction, DeveloperRole, DeveloperLevel, TicketSeverity } from './types';

/**
 * Parses a string to extract all key-value attributes.
 * Handles double-quotes, single-quotes, and unquoted values.
 */
export function parseAttributes(tagContent: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/g;
  let match;
  while ((match = regex.exec(tagContent)) !== null) {
    const name = match[1];
    const value = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : match[4]);
    attrs[name] = value;
  }
  return attrs;
}

/**
 * Robustly parses XML-like tags from free-text model output and maps them to LLMAction objects.
 */
export function parseLLMResponse(text: string): LLMAction[] {
  const actions: LLMAction[] = [];
  
  // Supported tags regex: matches <add_ticket ...>, <add_bug_ticket ...>, etc.
  // Supports both self-closing (/>) and matching close tags.
  const tagRegex = /<(add_ticket|add_bug_ticket|dev_applied|dev_quit|market_event)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  
  let match;
  while ((match = tagRegex.exec(text)) !== null) {
    const tagName = match[1].toLowerCase();
    const attributesStr = match[2];
    const bodyContent = match[3] || ''; // in case there's inner content (usually not for self-closing tags)
    
    const attrs = parseAttributes(attributesStr);
    
    // Add inner body content as description or blurb if attributes don't define them
    if (bodyContent.trim()) {
      if (tagName === 'add_ticket' || tagName === 'add_bug_ticket') {
        attrs.description = attrs.description || bodyContent.trim();
      } else if (tagName === 'dev_applied') {
        attrs.blurb = attrs.blurb || bodyContent.trim();
      }
    }
    
    switch (tagName) {
      case 'add_ticket': {
        const title = attrs.title || 'Untitled Feature';
        const description = attrs.description || '';
        const type = (attrs.type === 'tech_debt' ? 'tech_debt' : 'feature') as 'feature' | 'tech_debt';
        
        let severity: TicketSeverity = 'medium';
        if (['low', 'medium', 'high', 'critical'].includes(attrs.severity)) {
          severity = attrs.severity as TicketSeverity;
        }
        
        const storyPoints = parseInt(attrs.storyPoints, 10) || 5;
        const revenueIncrease = parseFloat(attrs.revenueIncrease) || 0;
        const revenuePenalty = parseFloat(attrs.revenuePenalty) || 0;
        
        actions.push({
          type: 'add_ticket',
          payload: {
            title,
            description,
            type,
            severity,
            storyPoints,
            revenueIncrease,
            revenuePenalty,
          },
        });
        break;
      }
      
      case 'add_bug_ticket': {
        const title = attrs.title || 'Untitled Bug';
        const description = attrs.description || '';
        
        let severity: TicketSeverity = 'high';
        if (['low', 'medium', 'high', 'critical'].includes(attrs.severity)) {
          severity = attrs.severity as TicketSeverity;
        }
        
        const storyPoints = parseInt(attrs.storyPoints, 10) || 3;
        const revenuePenalty = parseFloat(attrs.revenuePenalty) || 500;
        
        actions.push({
          type: 'add_bug_ticket',
          payload: {
            title,
            description,
            type: 'bug',
            severity,
            storyPoints,
            revenueIncrease: 0,
            revenuePenalty,
          },
        });
        break;
      }
      
      case 'dev_applied': {
        const name = attrs.name || 'Anonymous Developer';
        
        let role: DeveloperRole = 'fullstack';
        if (['frontend', 'backend', 'fullstack', 'devops', 'ml', 'dba'].includes(attrs.role)) {
          role = attrs.role as DeveloperRole;
        }
        
        let level: DeveloperLevel = 'mid';
        if (['junior', 'mid', 'senior', 'staff'].includes(attrs.level)) {
          level = attrs.level as DeveloperLevel;
        }
        
        const salary = parseInt(attrs.salary, 10) || 6000;
        const velocity = parseInt(attrs.velocity, 10) || 5;
        const blurb = attrs.blurb || '';
        
        // Generate a unique candidate ID
        const id = `c-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        
        actions.push({
          type: 'dev_applied',
          payload: {
            id,
            name,
            role,
            level,
            salary,
            velocity,
            blurb,
          },
        });
        break;
      }
      
      case 'dev_quit': {
        const developerId = attrs.developerId || '';
        const reason = attrs.reason || 'Resigned';
        
        actions.push({
          type: 'dev_quit',
          payload: {
            developerId,
            reason,
          },
        });
        break;
      }
      
      case 'market_event': {
        const headline = attrs.headline || 'Market Event';
        const revenueEffect = parseFloat(attrs.revenueEffect) || 0;
        const cashEffect = parseFloat(attrs.cashEffect) || 0;
        const permanent = attrs.permanent === 'true';
        
        actions.push({
          type: 'market_event',
          payload: {
            headline,
            revenueEffect,
            cashEffect,
            permanent,
          },
        });
        break;
      }
    }
  }
  
  return actions;
}
