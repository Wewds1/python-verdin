import React from 'react';
import { Link, useLocation } from 'react-router-dom';

function SideNavigation({ onSettingsToggle }){
    const top_menu = [
        {
            title: 'Live Feeds',
            icon: '<i class="fa fa-tv"></i>',
            link: '/'
        },
        {
            title: 'Resource Monitoring',
            icon: '<i class="fa-solid fa-gauge-high"></i>',
            link: '/resource-monitoring'
        },
        {
            title: 'Clients',
            icon: '<i class="fa fa-users"></i>',
            link: '/clients'
        },
        {
            title: 'Users',
            icon: '<i class="fa fa-user-group"></i>',
            link: '/users'
        }
    ];

    const bottom_menu = [
        {
            title: 'System Logs',
            icon: '<i class="fa fa-book"></i>',
            link: '/system-logs'
        }
    ]

    return (
        <div id="side-navigation">
            <div className="top-menu">
                {top_menu.map((item, index) => (
                    <Link
                        key={index}
                        to={item.link}
                        title={item.title}
                        dangerouslySetInnerHTML={{ __html: `${item.icon}` }}
                    >
                    </Link>
                ))}
            </div>
            <div className="bottom-menu">
                {bottom_menu.map((item, index) => (
                    <Link
                        key={index}
                        to={item.link}
                        title={item.title}
                        dangerouslySetInnerHTML={{ __html: `${item.icon}` }}
                    >
                    </Link>
                ))}
                {/* <Link to="/messages" title="Messages" dangerouslySetInnerHTML={{ __html: "<i class='fa-solid fa-envelope'></i>" }}></Link> */}
                <Link to="#" onClick={onSettingsToggle} title="Settings" dangerouslySetInnerHTML={{ __html: "<i class='fa fa-gear'></i>" }}></Link>
            </div>
        </div>
    )
}

export default SideNavigation;
